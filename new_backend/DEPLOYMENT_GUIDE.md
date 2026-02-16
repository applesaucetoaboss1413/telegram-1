# Telegram Face Swap Bot - Production Deployment Guide

## Overview
This guide provides comprehensive instructions for deploying the Telegram Face Swap Bot to production with 24/7 availability, monitoring, and proper operational procedures.

## Prerequisites

### Required Services
- **Render Account**: For hosting the application
- **Telegram Bot**: BotFather created bot with token
- **Stripe Account**: For payment processing
- **MagicAPI Account**: For face swap functionality
- **GitHub Repository**: For version control and CI/CD

### Required Tools
- Node.js 18.18.0 or higher
- npm or yarn
- Git
- PM2 (for process management)

## Environment Configuration

### 1. Environment Variables
Create a `.env.production` file with the following variables:

```bash
# Core Configuration
NODE_ENV=production
PORT=3000

# Telegram Bot
BOT_TOKEN=your_telegram_bot_token_here

# Face Swap API
MAGICAPI_KEY=your_magicapi_key_here

# Stripe Payment
STRIPE_SECRET_KEY=your_stripe_secret_key_here
STRIPE_WEBHOOK_SECRET=your_stripe_webhook_secret_here
STRIPE_SUCCESS_URL=https://t.me/YOUR_BOT_USERNAME?start=success
STRIPE_CANCEL_URL=https://t.me/YOUR_BOT_USERNAME?start=cancel

# Admin Configuration
ADMIN_SECRET=generate_a_secure_admin_secret_here

# Monitoring
LOG_LEVEL=info
HEALTH_CHECK_INTERVAL=30000
ALERT_THRESHOLD_CPU=80
ALERT_THRESHOLD_MEMORY=85
```

### 2. Render Configuration
The `render.yaml` file contains the production deployment configuration:
- Auto-scaling from 1-3 instances
- Health checks every 30 seconds
- Automatic restarts on failure
- Daily backups at 2 AM

## Deployment Process

### 1. Manual Deployment
```bash
# Clone the repository
git clone https://github.com/your-username/telegram-faceswap-bot.git
cd telegram-faceswap-bot/new_backend

# Install dependencies
npm install

# Set up environment variables
cp .env.production .env
# Edit .env with your actual values

# Run deployment script
chmod +x deploy.sh
./deploy.sh production
```

### 2. Automated Deployment (GitHub Actions)
The CI/CD pipeline automatically:
1. Runs tests on every push
2. Deploys to production on main branch
3. Performs health checks
4. Sends notifications

### 3. Render Deployment
1. Connect your GitHub repository to Render
2. Configure environment variables in Render dashboard
3. Deploy using the provided `render.yaml` configuration

## Monitoring and Health Checks

### Health Check Endpoints
- **/health** - Comprehensive system health check
- **/ready** - Readiness probe for Kubernetes
- **/alive** - Liveness probe for auto-restart
- **/metrics** - Application metrics and monitoring data
- **/monitoring/health** - Monitoring system health

### Monitoring Dashboard
Access monitoring data at:
- Production: `https://your-app.onrender.com/metrics`
- Health Status: `https://your-app.onrender.com/health`

### Alert Configuration
Configure alerts for:
- High CPU usage (>80%)
- High memory usage (>85%)
- High response time (>5s)
- High error rate (>5%)
- Database connectivity issues
- Telegram API failures

## Operational Procedures

### Daily Operations
1. **Health Check Review**: Check `/health` endpoint daily
2. **Log Review**: Review error logs for any issues
3. **Performance Monitoring**: Monitor response times and resource usage
4. **Backup Verification**: Verify daily backups are successful

### Weekly Operations
1. **Security Updates**: Check for security vulnerabilities
2. **Performance Analysis**: Review performance metrics
3. **User Analytics**: Check user engagement and usage patterns
4. **Cost Review**: Monitor hosting costs and usage

### Monthly Operations
1. **Dependency Updates**: Update npm packages
2. **Security Audit**: Run comprehensive security audit
3. **Disaster Recovery Test**: Test backup restoration
4. **Performance Optimization**: Review and optimize performance

## Troubleshooting

### Common Issues

#### Bot Not Responding
1. Check Telegram API connectivity: `curl https://api.telegram.org/bot$BOT_TOKEN/getMe`
2. Verify webhook URL is accessible
3. Check application logs for errors

#### Face Detection Not Working
1. Verify TensorFlow models are loaded
2. Check image processing pipeline
3. Review face detection service logs

#### Payment Processing Issues
1. Verify Stripe webhook configuration
2. Check Stripe API connectivity
3. Review payment processing logs

#### High Memory Usage
1. Check for memory leaks in logs
2. Review image processing pipeline
3. Consider increasing instance size

### Emergency Procedures

#### Service Outage
1. Check health endpoint status
2. Review recent deployment logs
3. Rollback to previous version if necessary
4. Contact support if issue persists

#### Database Corruption
1. Stop the application
2. Restore from latest backup
3. Verify data integrity
4. Restart application

#### Security Incident
1. Immediately revoke compromised tokens
2. Review access logs
3. Update all secrets
4. Notify users if necessary

## Performance Optimization

### Scaling Configuration
- **Auto-scaling**: 1-3 instances based on CPU/memory usage
- **Load balancing**: Automatic with Render
- **Database**: SQLite with regular backups

### Caching Strategy
- **Telegram Updates**: Processed in real-time
- **Face Detection Models**: Cached in memory
- **User Data**: Cached for performance

### Resource Limits
- **Memory**: 500MB per instance
- **CPU**: 1 vCPU per instance
- **Disk**: 1GB for application + database

## Security Best Practices

### Secrets Management
- Use environment variables for all secrets
- Rotate keys regularly
- Use strong, unique passwords
- Enable 2FA on all accounts

### Access Control
- Limit admin access
- Use secure admin endpoints
- Monitor access logs
- Regular security audits

### Data Protection
- Encrypt sensitive data
- Regular security updates
- Secure webhook endpoints
- GDPR compliance for user data

## Cost Management

### Render Pricing
- **Starter Plan**: $7/month per instance
- **Auto-scaling**: Additional instances as needed
- **Bandwidth**: Included in plan
- **Storage**: 1GB included

### Optimization Tips
1. Monitor resource usage
2. Optimize image processing
3. Use efficient algorithms
4. Regular performance reviews

## Support and Maintenance

### Documentation
- API documentation: Available in repository
- Code comments: Comprehensive inline documentation
- Operational procedures: This guide

### Support Channels
- GitHub Issues: Bug reports and feature requests
- Email: For urgent issues
- Monitoring alerts: Automated notifications

### Maintenance Schedule
- **Daily**: Health checks and log review
- **Weekly**: Performance monitoring
- **Monthly**: Updates and optimization
- **Quarterly**: Security audits and planning

## Backup and Recovery

### Backup Strategy
- **Database**: Daily automated backups
- **Configuration**: Version controlled in Git
- **Logs**: Retained for 30 days
- **User Data**: Encrypted and backed up

### Recovery Procedures
1. **Database Recovery**: Restore from backup
2. **Configuration Recovery**: Git checkout
3. **Application Recovery**: Redeploy from Git
4. **Data Recovery**: Restore user data from backup

## Conclusion

This deployment guide ensures your Telegram Face Swap Bot operates reliably in production with proper monitoring, alerting, and operational procedures. Regular maintenance and monitoring will ensure 24/7 availability and optimal performance.

For additional support or questions, please refer to the documentation or contact the development team.