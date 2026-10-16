/**
 * Four backend instances behind nginx (see /etc/nginx/conf.d/zicab-upstream.conf).
 *
 * Fork mode on four ports, not pm2 cluster mode: cluster shares one port and
 * round-robins every request, which breaks Socket.IO's polling handshake — the
 * handshake spans several HTTP requests that must all reach the same process.
 * Separate ports let nginx balance with ip_hash so a client sticks to one
 * instance for the life of its session.
 *
 * Each port is its own app rather than `instances: 4` + `increment_var: 'PORT'`,
 * because increment_var only applies on the initial `pm2 start`. A later
 * `pm2 reload` or a resurrect after reboot hands every instance PORT=5000, so
 * one binds and the other three crash-loop on EADDRINUSE — quietly leaving a
 * single instance behind a load balancer that thinks it has four.
 *
 * PORT is set here rather than in .env: dotenv does not override a variable that
 * is already present in the environment, so this value wins.
 */
const PORTS = [5000, 5001, 5002, 5003];

module.exports = {
  apps: PORTS.map((port) => ({
    name: `zicab-api-${port}`,
    script: 'server.js',
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
      PORT: port,
    },
    max_memory_restart: '700M',
    time: true,
    kill_timeout: 8000,
  })),
};
