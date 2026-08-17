module.exports = {
  apps: [
    {
      name: 'roadscore-engine',
      cwd: './engine',
      script: 'node',
      args: 'dist/index.js',
      instances: 1, // Engine must run as a single instance to maintain in-memory fleet state & pipeline
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 8080,
      },
    },
    {
      name: 'roadscore-web',
      cwd: './web',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3000',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
    },
  ],
};
