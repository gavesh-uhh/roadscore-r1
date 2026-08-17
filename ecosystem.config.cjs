module.exports = {
  apps: [
    {
      name: 'roadscore-engine',
      cwd: './engine',
      script: 'dist/index.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
        HOST: '0.0.0.0',
      },
      time: true,
      error_file: '../logs/engine-error.log',
      out_file: '../logs/engine-out.log',
      merge_logs: true,
    },
  ],
};
