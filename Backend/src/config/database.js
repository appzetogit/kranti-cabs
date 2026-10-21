import mongoose from 'mongoose';
import { env } from './env.js';

/// Whether the connected server can run multi-document transactions: a replica
/// set member or a mongos. A standalone mongod cannot, and refuses them with
/// "Transaction numbers are only allowed on a replica set member or mongos".
const serverSupportsTransactions = async (connection) => {
  try {
    const hello = await connection.db.admin().command({ hello: 1 });
    return Boolean(hello.setName) || hello.msg === 'isdbgrid';
  } catch {
    // Unknown: keep real transactions, as before.
    return true;
  }
};

/// On a standalone server, sessions still work but transactions do not. The
/// app wraps related writes (wallet debits, subscriptions, ride acceptance,
/// promo use, ...) in transactions, so every one of those requests failed.
/// Here the transaction calls become no-ops: the writes run in order on a
/// plain session, as they would on any single-node setup, and only lose the
/// all-or-nothing guarantee if the process dies half way through.
const installStandaloneTransactionFallback = () => {
  const startSession = mongoose.startSession.bind(mongoose);

  mongoose.startSession = async (...args) => {
    const session = await startSession(...args);
    session.startTransaction = () => {};
    session.commitTransaction = async () => {};
    session.abortTransaction = async () => {};
    session.inTransaction = () => false;
    session.withTransaction = async (fn) => fn(session);
    return session;
  };
};

export const connectDatabase = async () => {
  mongoose.set('strictQuery', true);

  const connection = await mongoose.connect(env.mongoUri, {
    autoIndex: env.nodeEnv !== 'production',
    dbName: env.mongoDbName,
  });

  const { host, name } = connection.connection;
  console.log(`MongoDB connected to ${host}/${name}`);

  if (!(await serverSupportsTransactions(connection.connection))) {
    installStandaloneTransactionFallback();
    console.warn('[mongo] standalone server: transactions run as plain sequential writes');
  }
};
