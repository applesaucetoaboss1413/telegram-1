const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const winston = require('winston');

// Configure logger
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.Console({
            format: winston.format.simple()
        }),
        new winston.transports.File({ filename: 'logs/backup.log' })
    ]
});

class BackupManager {
    constructor() {
        this.backupDir = path.join(__dirname, '..', 'backups');
        this.dataDir = path.join(__dirname, '..', 'data');
        this.logsDir = path.join(__dirname, '..', 'logs');
        
        this.ensureDirectories();
    }

    ensureDirectories() {
        if (!fs.existsSync(this.backupDir)) {
            fs.mkdirSync(this.backupDir, { recursive: true });
            logger.info('Created backup directory');
        }
    }

    async createBackup() {
        try {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backupName = `backup_${timestamp}`;
            const backupPath = path.join(this.backupDir, backupName);
            
            logger.info(`Creating backup: ${backupName}`);
            
            // Create backup directory
            fs.mkdirSync(backupPath, { recursive: true });
            
            // Backup database
            const dbPath = path.join(this.dataDir, 'faceswap.db');
            if (fs.existsSync(dbPath)) {
                const dbBackupPath = path.join(backupPath, 'faceswap.db');
                fs.copyFileSync(dbPath, dbBackupPath);
                logger.info('Database backed up');
            } else {
                logger.warn('Database file not found, skipping database backup');
            }
            
            // Backup environment files
            const envFiles = ['.env', '.env.production', '.env.staging'];
            for (const envFile of envFiles) {
                const envPath = path.join(__dirname, '..', envFile);
                if (fs.existsSync(envPath)) {
                    const envBackupPath = path.join(backupPath, envFile);
                    fs.copyFileSync(envPath, envBackupPath);
                    logger.info(`Environment file ${envFile} backed up`);
                }
            }
            
            // Backup configuration files
            const configFiles = ['package.json', 'package-lock.json', 'render.yaml', 'ecosystem.config.js'];
            for (const configFile of configFiles) {
                const configPath = path.join(__dirname, '..', configFile);
                if (fs.existsSync(configPath)) {
                    const configBackupPath = path.join(backupPath, configFile);
                    fs.copyFileSync(configPath, configBackupPath);
                    logger.info(`Configuration file ${configFile} backed up`);
                }
            }
            
            // Create backup metadata
            const metadata = {
                timestamp: new Date().toISOString(),
                version: process.env.npm_package_version || '1.0.0',
                nodeVersion: process.version,
                platform: process.platform,
                files: fs.readdirSync(backupPath)
            };
            
            const metadataPath = path.join(backupPath, 'metadata.json');
            fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
            logger.info('Backup metadata created');
            
            // Clean up old backups (keep last 7 days)
            this.cleanupOldBackups();
            
            logger.info(`Backup completed successfully: ${backupName}`);
            return backupName;
            
        } catch (error) {
            logger.error('Backup failed', error);
            throw error;
        }
    }

    async restoreBackup(backupName) {
        try {
            const backupPath = path.join(this.backupDir, backupName);
            
            if (!fs.existsSync(backupPath)) {
                throw new Error(`Backup not found: ${backupName}`);
            }
            
            logger.info(`Restoring backup: ${backupName}`);
            
            // Read metadata
            const metadataPath = path.join(backupPath, 'metadata.json');
            if (!fs.existsSync(metadataPath)) {
                throw new Error('Backup metadata not found');
            }
            
            const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
            logger.info(`Backup created: ${metadata.timestamp}`);
            
            // Restore database
            const dbBackupPath = path.join(backupPath, 'faceswap.db');
            if (fs.existsSync(dbBackupPath)) {
                const dbPath = path.join(this.dataDir, 'faceswap.db');
                
                // Backup current database
                if (fs.existsSync(dbPath)) {
                    const currentBackupPath = path.join(this.backupDir, `current_backup_${Date.now()}.db`);
                    fs.copyFileSync(dbPath, currentBackupPath);
                    logger.info('Current database backed up before restore');
                }
                
                fs.copyFileSync(dbBackupPath, dbPath);
                logger.info('Database restored');
            }
            
            // Restore environment files
            const envFiles = ['.env', '.env.production', '.env.staging'];
            for (const envFile of envFiles) {
                const envBackupPath = path.join(backupPath, envFile);
                if (fs.existsSync(envBackupPath)) {
                    const envPath = path.join(__dirname, '..', envFile);
                    fs.copyFileSync(envBackupPath, envPath);
                    logger.info(`Environment file ${envFile} restored`);
                }
            }
            
            logger.info(`Backup restored successfully: ${backupName}`);
            return metadata;
            
        } catch (error) {
            logger.error('Restore failed', error);
            throw error;
        }
    }

    cleanupOldBackups() {
        try {
            const backups = fs.readdirSync(this.backupDir)
                .filter(dir => dir.startsWith('backup_'))
                .map(dir => ({
                    name: dir,
                    path: path.join(this.backupDir, dir),
                    mtime: fs.statSync(path.join(this.backupDir, dir)).mtime
                }))
                .sort((a, b) => b.mtime - a.mtime);
            
            // Keep last 7 days of backups
            const sevenDaysAgo = new Date();
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
            
            const oldBackups = backups.filter(backup => backup.mtime < sevenDaysAgo);
            
            for (const backup of oldBackups) {
                fs.rmSync(backup.path, { recursive: true, force: true });
                logger.info(`Deleted old backup: ${backup.name}`);
            }
            
            logger.info(`Cleanup completed. ${oldBackups.length} old backups removed.`);
            
        } catch (error) {
            logger.error('Backup cleanup failed', error);
        }
    }

    listBackups() {
        try {
            const backups = fs.readdirSync(this.backupDir)
                .filter(dir => dir.startsWith('backup_'))
                .map(dir => {
                    const backupPath = path.join(this.backupDir, dir);
                    const metadataPath = path.join(backupPath, 'metadata.json');
                    
                    let metadata = null;
                    if (fs.existsSync(metadataPath)) {
                        try {
                            metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
                        } catch (error) {
                            logger.warn(`Failed to read metadata for ${dir}`);
                        }
                    }
                    
                    const stats = fs.statSync(backupPath);
                    
                    return {
                        name: dir,
                        created: stats.mtime,
                        size: this.getDirectorySize(backupPath),
                        metadata: metadata
                    };
                })
                .sort((a, b) => b.created - a.created);
            
            return backups;
            
        } catch (error) {
            logger.error('Failed to list backups', error);
            return [];
        }
    }

    getDirectorySize(dirPath) {
        let totalSize = 0;
        
        try {
            const files = fs.readdirSync(dirPath);
            
            for (const file of files) {
                const filePath = path.join(dirPath, file);
                const stats = fs.statSync(filePath);
                
                if (stats.isDirectory()) {
                    totalSize += this.getDirectorySize(filePath);
                } else {
                    totalSize += stats.size;
                }
            }
            
        } catch (error) {
            logger.error(`Failed to calculate size for ${dirPath}`, error);
        }
        
        return totalSize;
    }
}

// CLI interface
if (require.main === module) {
    const backupManager = new BackupManager();
    const command = process.argv[2];
    
    switch (command) {
        case 'create':
            backupManager.createBackup()
                .then(backupName => {
                    logger.info(`Backup created: ${backupName}`);
                    process.exit(0);
                })
                .catch(error => {
                    logger.error('Backup failed', error);
                    process.exit(1);
                });
            break;
            
        case 'restore':
            const backupName = process.argv[3];
            if (!backupName) {
                logger.error('Please specify backup name to restore');
                process.exit(1);
            }
            
            backupManager.restoreBackup(backupName)
                .then(metadata => {
                    logger.info(`Backup restored: ${backupName}`);
                    logger.info(`Original backup from: ${metadata.timestamp}`);
                    process.exit(0);
                })
                .catch(error => {
                    logger.error('Restore failed', error);
                    process.exit(1);
                });
            break;
            
        case 'list':
            const backups = backupManager.listBackups();
            logger.info('Available backups:');
            backups.forEach(backup => {
                logger.info(`- ${backup.name} (${backup.created.toISOString()}) - ${Math.round(backup.size / 1024)}KB`);
            });
            process.exit(0);
            break;
            
        case 'cleanup':
            backupManager.cleanupOldBackups();
            process.exit(0);
            break;
            
        default:
            logger.info('Usage: node backup.js [create|restore|list|cleanup] [backup_name]');
            process.exit(0);
    }
}

module.exports = BackupManager;