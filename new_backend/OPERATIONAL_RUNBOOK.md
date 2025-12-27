# Telegram Face Swap Bot - Operational Runbook

## Emergency Contacts
- **Primary Developer**: [Your Name] - [Email] - [Phone]
- **Secondary Support**: [Backup Contact] - [Email] - [Phone]
- **Infrastructure Provider**: Render Support
- **Payment Provider**: Stripe Support

## Service Overview
The Telegram Face Swap Bot provides face swapping functionality with payment integration. The service runs on Render with automatic scaling and monitoring.

## Service Status
- **Production URL**: https://telegram-faceswap-bot.onrender.com
- **Health Check**: https://telegram-faceswap-bot.onrender.com/health
- **Monitoring**: https://telegram-faceswap-bot.onrender.com/metrics
- **Status Page**: [Create status page URL]

## Quick Reference

### Essential Commands
```bash
# Check service health
curl https://telegram-faceswap-bot.onrender.com/health

# View recent logs
pm2 logs telegram-faceswap-bot

# Restart service
pm2 restart telegram-faceswap-bot

# Check service status
pm2 status telegram-faceswap-bot

# View monitoring metrics
curl https://telegram-faceswap-bot.onrender.com/metrics
```

### Key URLs
- **Application**: https://telegram-faceswap-bot.onrender.com
- **Health**: /health
- **Metrics**: /metrics
- **Admin**: /admin/grant (POST)
- **Stripe Webhook**: /webhook

## Incident Response Procedures

### Severity Levels
- **P0 - Critical**: Service completely down, no functionality
- **P1 - High**: Major functionality broken, service degraded
- **P2 - Medium**: Minor functionality issues, workarounds available
- **P3 - Low**: Cosmetic issues, no impact on functionality

### P0 - Critical Incident Response

#### Symptoms
- Health check returns 503
- No response from Telegram bot
- Payment processing completely broken
- Database inaccessible

#### Immediate Actions (0-15 minutes)
1. **Assess Impact**
   - Check health endpoint: `curl https://telegram-faceswap-bot.onrender.com/health`
   - Check Render dashboard status
   - Verify Telegram bot responds to /start command

2. **Initial Diagnosis**
   - Check application logs in Render dashboard
   - Verify environment variables are set correctly
   - Check database connectivity

3. **Quick Fixes**
   - Restart service via Render dashboard
   - Check for recent deployments that might have caused issues
   - Verify payment gateway connectivity

#### Recovery Actions (15-60 minutes)
1. **If restart fails**
   - Rollback to previous deployment
   - Check for configuration issues
   - Verify all external service dependencies

2. **If database issues**
   - Check database backup status
   - Attempt database recovery
   - Contact Render support if needed

3. **If external service issues**
   - Check Telegram API status
   - Check Stripe API status
   - Check MagicAPI status

#### Communication
- **Internal**: Notify team via Slack/email
- **External**: Update status page if available
- **Users**: Post status update if service is down >30 minutes

### P1 - High Incident Response

#### Symptoms
- Face detection not working
- Payment processing intermittent
- High error rates (>10%)
- Slow response times (>5s)

#### Actions
1. **Check monitoring metrics**
   - Review error rates and response times
   - Check system resource usage
   - Verify face detection service status

2. **Investigate specific functionality**
   - Test face detection with sample images
   - Verify Stripe webhook configuration
   - Check for recent code changes

3. **Implement fixes**
   - Restart specific services if needed
   - Clear any cached data causing issues
   - Scale up resources if needed

## Monitoring and Alerting

### Key Metrics to Monitor
- **Uptime**: Target 99.9% availability
- **Response Time**: <2s average, <5s 95th percentile
- **Error Rate**: <1% overall, <5% per endpoint
- **Memory Usage**: <80% of allocated memory
- **CPU Usage**: <70% average utilization

### Alert Thresholds
- **Critical**: Service down, error rate >10%, memory >90%
- **Warning**: Error rate >5%, response time >3s, memory >80%
- **Info**: Daily health checks, deployment notifications

### Monitoring URLs
- **Health Status**: https://telegram-faceswap-bot.onrender.com/health
- **Detailed Metrics**: https://telegram-faceswap-bot.onrender.com/metrics
- **System Status**: https://telegram-faceswap-bot.onrender.com/monitoring/health

## Deployment Procedures

### Regular Deployment
1. **Pre-deployment checks**
   - Verify all tests pass
   - Check staging environment
   - Review deployment notes

2. **Deployment process**
   - Deploy via GitHub Actions or Render
   - Monitor health checks during deployment
   - Verify functionality post-deployment

3. **Post-deployment verification**
   - Run health checks
   - Test core functionality
   - Monitor error rates for 30 minutes

### Emergency Deployment
1. **Rollback procedure**
   - Use Render dashboard to rollback
   - Verify previous version works
   - Communicate status to team

2. **Hotfix deployment**
   - Create hotfix branch
   - Apply minimal fix
   - Deploy via emergency process

## Maintenance Procedures

### Daily Maintenance (Automated)
- Health check monitoring
- Log rotation and cleanup
- Backup verification
- Performance metrics collection

### Weekly Maintenance
- Review error logs and trends
- Check resource usage patterns
- Verify backup integrity
- Update dependencies if needed

### Monthly Maintenance
- Security audit and updates
- Performance optimization review
- Capacity planning assessment
- Documentation updates

### Quarterly Maintenance
- Disaster recovery testing
- Security penetration testing
- Architecture review
- Cost optimization review

## Troubleshooting Guide

### Common Issues and Solutions

#### Bot Not Responding
```bash
# Check bot token
curl https://api.telegram.org/bot$BOT_TOKEN/getMe

# Check webhook status
curl https://telegram-faceswap-bot.onrender.com/health

# Restart bot
pm2 restart telegram-faceswap-bot
```

#### Face Detection Issues
```bash
# Check face detection service
curl https://telegram-faceswap-bot.onrender.com/health

# Verify model loading
pm2 logs telegram-faceswap-bot | grep -i "face"

# Check memory usage
pm2 monit
```

#### Payment Processing Issues
```bash
# Check Stripe webhook
curl -X POST https://telegram-faceswap-bot.onrender.com/webhook \
  -H "Content-Type: application/json" \
  -H "Stripe-Signature: test"

# Check Stripe API status
curl https://api.stripe.com/v1/charges \
  -u $STRIPE_SECRET_KEY:
```

#### Database Issues
```bash
# Check database connectivity
sqlite3 data/faceswap.db ".tables"

# Check database size
ls -lh data/faceswap.db

# Backup database
cp data/faceswap.db backups/faceswap_$(date +%Y%m%d_%H%M%S).db
```

### Performance Issues

#### High Memory Usage
1. Check for memory leaks in logs
2. Restart service to clear memory
3. Scale up instance size if needed
4. Optimize image processing pipeline

#### Slow Response Times
1. Check database query performance
2. Optimize face detection processing
3. Consider caching strategies
4. Scale up resources if needed

#### High Error Rates
1. Check recent deployments
2. Review error logs for patterns
3. Verify external service dependencies
4. Check for rate limiting issues

## Backup and Recovery

### Backup Procedures
- **Database**: Daily automated backups
- **Configuration**: Version controlled
- **Logs**: Retained for 30 days
- **User Data**: Encrypted and backed up

### Recovery Procedures
1. **Database Recovery**
   - Restore from latest backup
   - Verify data integrity
   - Test functionality

2. **Service Recovery**
   - Restart from known good state
   - Verify all dependencies
   - Test core functionality

3. **Complete System Recovery**
   - Restore from backup
   - Verify all components
   - Perform full functionality test

## Security Procedures

### Security Monitoring
- Monitor access logs for suspicious activity
- Check for unauthorized API usage
- Verify SSL certificate status
- Monitor for security vulnerabilities

### Incident Response
1. **Security Incident Detection**
   - Unusual access patterns
   - Failed authentication attempts
   - Suspicious API usage

2. **Immediate Response**
   - Revoke compromised tokens
   - Block suspicious IP addresses
   - Notify security team

3. **Recovery**
   - Update all secrets
   - Review access controls
   - Document incident

## Communication Procedures

### Internal Communication
- **Slack**: Primary communication channel
- **Email**: For formal notifications
- **Phone**: For urgent issues

### External Communication
- **Status Page**: For service status updates
- **User Notifications**: For planned maintenance
- **Social Media**: For major incidents

### Escalation Matrix
- **Level 1**: On-call engineer (0-30 minutes)
- **Level 2**: Senior engineer (30-60 minutes)
- **Level 3**: Team lead/manager (60+ minutes)

## Documentation Maintenance

### Update Procedures
- Update runbook after each incident
- Review procedures quarterly
- Update contact information as needed
- Maintain version history

### Review Schedule
- **Monthly**: Review and update procedures
- **Quarterly**: Full runbook review
- **Annually**: Complete overhaul if needed

## Appendices

### Useful Commands
```bash
# Service management
pm2 status
pm2 logs telegram-faceswap-bot
pm2 restart telegram-faceswap-bot
pm2 monit

# Health checks
curl https://telegram-faceswap-bot.onrender.com/health
curl https://telegram-faceswap-bot.onrender.com/metrics

# Database
sqlite3 data/faceswap.db ".tables"
sqlite3 data/faceswap.db "SELECT COUNT(*) FROM users"

# Logs
tail -f logs/application.log
tail -f logs/error.log
grep -i "error" logs/application.log
```

### Contact Information
- **Primary**: [Your contact details]
- **Backup**: [Backup contact details]
- **Render Support**: support@render.com
- **Stripe Support**: support@stripe.com

### External Resources
- **Render Status**: https://status.render.com
- **Stripe Status**: https://status.stripe.com
- **Telegram API**: https://core.telegram.org/api

This runbook should be reviewed and updated regularly to ensure it remains current and effective.