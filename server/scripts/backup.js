import fs from 'fs-extra';
import path from 'path';

export async function createSystemBackup() {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = path.resolve('backups', `backup_${timestamp}`);
    await fs.ensureDir(backupDir);

    console.log(`=============================================================`);
    console.log(`  STARTING SYSTEM BACKUP: ${backupDir}`);
    console.log(`=============================================================`);

    // 1. Backup Database
    const dbPath = path.resolve(process.env.DB_FILE || 'database.sqlite');
    if (await fs.pathExists(dbPath)) {
      await fs.copy(dbPath, path.join(backupDir, 'database.sqlite'));
      console.log(`[BACKUP DB]: Copied SQLite database file.`);
    }

    // 2. Backup Uploads Directory (Employee photos + Attendance evidence)
    const uploadsDir = path.resolve('uploads');
    let photoCount = 0;
    if (await fs.pathExists(uploadsDir)) {
      await fs.copy(uploadsDir, path.join(backupDir, 'uploads'));
      const files = await fs.readdir(path.join(backupDir, 'uploads'), { recursive: true });
      photoCount = files.length;
      console.log(`[BACKUP PHOTOS]: Copied ${photoCount} files from uploads/ directory.`);
    }

    // 3. Write Backup Metadata
    const metadata = {
      timestamp: new Date().toISOString(),
      backupFolder: backupDir,
      dbEngine: process.env.DB_TYPE || 'sqlite',
      photoFilesCount: photoCount
    };

    await fs.writeJson(path.join(backupDir, 'backup-metadata.json'), metadata, { spaces: 2 });
    console.log(`=============================================================`);
    console.log(`  BACKUP COMPLETE SUCCESSFULLY: ${backupDir}`);
    console.log(`=============================================================`);

    return metadata;
  } catch (err) {
    console.error(`[BACKUP ERROR]: System backup failed`, err);
    throw err;
  }
}

// Allow direct execution from terminal via node backend/src/scripts/backup.js
if (process.argv[1]?.endsWith('backup.js')) {
  createSystemBackup().catch(console.error);
}
