{
  "apps": [
    {
      "name": "telegram-faceswap-bot",
      "script": "index.js",
      "cwd": "/app",
      "instances": 1,
      "exec_mode": "fork",
      "watch": false,
      "max_memory_restart": "500M",
      "restart_delay": 4000,
      "max_restarts": 10,
      "min_uptime": "10s",
      "env": {
        "NODE_ENV": "production",
        "PORT": 3000
      },
      "error_file": "./logs/pm2-error.log",
      "out_file": "./logs/pm2-out.log",
      "log_file": "./logs/pm2-combined.log",
      "time": true,
      "merge_logs": true,
      "log_date_format": "YYYY-MM-DD HH:mm:ss Z",
      "kill_timeout": 5000,
      "listen_timeout": 8000,
      "shutdown_with_message": true,
      "wait_ready": true,
      "autorestart": true,
      "cron_restart": "0 3 * * *",
      "health_check_grace_period": 30000,
      "health_check_fatal_exceptions": true,
      "health_check_timeout": 3000,
      "health_check_http_url": "http://localhost:3000/health",
      "health_check_expected_status": 200,
      "health_check_max_attempts": 3,
      "health_check_retry_delay": 5000
    }
  ],
  "deploy": {
    "production": {
      "user": "node",
      "host": ["your-server.com"],
      "ref": "origin/main",
      "repo": "https://github.com/your-username/telegram-faceswap-bot.git",
      "path": "/var/www/telegram-faceswap-bot",
      "post-deploy": "npm install && pm2 reload ecosystem.config.js --env production",
      "pre-deploy-local": "",
      "post-deploy": "npm install && pm2 reload ecosystem.config.js --env production && pm2 save",
      "pre-setup": ""
    }
  }
}