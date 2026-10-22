import mongoose from 'mongoose';
import { env } from './env.js';

/// Whether the connected server can run multi-document transactions: a replica
/// set member or a mongos. A standalone mongod cannot, and refuses them with
/// "Transaction numbers are only allowed on a replica set member or mongos".
/// `hello` only exists on MongoDB 4.4.2+, so older servers are asked with the
/// legacy `isMaster`, which returns the same fields.
const serverSupportsTransactions = async (connection) => {
  const admin = connection.db.admin();

  for (const command of [{ hello: 1 }, { isMaster: 1 }]) {
    try {
      const reply = await admin.command(command);
      return Boolean(reply.setName) || reply.msg === 'isdbgrid';
    } catch {
      // Try the next command.
    }
  }

  // Unknown: keep real transactions; the runtime check below still catches it.
  return true;
};

const isStandaloneTransactionError = (error) =>
  /Transaction numbers are only allowed on a replica set member or mongos/i.test(String(error?.message || ''));

let transactionsSupported = true;

const markStandalone = () => {
  if (!transactionsSupported) return;
  transactionsSupported = false;
  console.warn('[mongo] standalone server: transactions run as plain sequential writes');
};

/// Turns the session's transaction calls into no-ops: the writes run in order
/// on a plain session, as they would on any single-node setup, and only lose
/// the all-or-nothing guarantee if the process dies half way through.
const makePlainSession = (session) => {
  session.startTransaction = () => {};
  session.commitTransaction = async () => {};
  session.abortTransaction = async () => {};
  session.inTransaction = () => false;
  session.withTransaction = async (fn) => fn(session);
  return session;
};

/// On a standalone server, sessions still work but transactions do not. The
/// app wraps related writes (wallet debits, subscriptions, ride acceptance,
/// promo use, ...) in transactions, so every one of those requests failed.
/// Sessions are made plain once the server is known to be standalone. If the
/// startup check got it wrong, the first refused withTransaction is rerun as
/// plain writes (the server refuses before writing anything) and every later
/// session is plain.
const installTransactionFallback = () => {
  const startSession = mongoose.startSession.bind(mongoose);

  mongoose.startSession = async (...args) => {
    const session = await startSession(...args);
    if (!transactionsSupported) return makePlainSession(session);

    const withTransaction = session.withTransaction.bind(session);
    session.withTransaction = async (fn, options) => {
      try {
        return await withTransaction(fn, options);
      } catch (error) {
        if (!isStandaloneTransactionError(error)) throw error;
        markStandalone();
        return makePlainSession(session).withTransaction(fn);
      }
    };

    return session;
  };
};

/// Flips the app to plain sessions when a manual startTransaction() call site
/// hits the standalone refusal, so only that one request fails.
export const noteTransactionError = (error) => {
  if (isStandaloneTransactionError(error)) markStandalone();
};

export const connectDatabase = async () => {
  mongoose.set('strictQuery', true);

  const connection = await mongoose.connect(env.mongoUri, {
    autoIndex: env.nodeEnv !== 'production',
    dbName: env.mongoDbName,
  });

  const { host, name } = connection.connection;
  console.log(`MongoDB connected to ${host}/${name}`);

  installTransactionFallback();

  if (await serverSupportsTransactions(connection.connection)) {
    console.log('[mongo] replica set / mongos: transactions enabled');
  } else {
    markStandalone();
  }
};
