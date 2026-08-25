import fs from 'fs-extra';
import path from 'path';

export async function restoreSystemBackup(backupFolderPath) {
  try {
    if (!backupFolderPath) {
      console.error(`[RESTORE ERROR]: Please specify backup folder path (e.g. node restore.js backups/backup_2026...)`);
      return;
    }

    const backupDir = path.resolve(backupFolderPath);
    if (!(await fs.pathExists(backupDir))) {
      throw new Error(`Backup folder not found at ${backupDir}`);
    }

    console.log(`=============================================================`);
    console.log(`  STARTING SYSTEM RESTORE FROM: ${backupDir}`);
    console.log(`=============================================================`);

    // Restore Database
    const backupDbPath = path.join(backupDir, 'database.sqlite');
    if (await fs.pathExists(backupDbPath)) {
      const targetDbPath = path.resolve(process.env.DB_FILE || 'database.sqlite');
      await fs.copy(backupDbPath, targetDbPath, { overwrite: true });
      console.log(`[RESTORE DB]: Restored database.sqlite`);
    }

    // Restore Uploads Directory
    const backupUploadsDir = path.join(backupDir, 'uploads');
    if (await fs.pathExists(backupUploadsDir)) {
      const targetUploadsDir = path.resolve('uploads');
      await fs.copy(backupUploadsDir, targetUploadsDir, { overwrite: true });
      console.log(`[RESTORE PHOTOS]: Restored uploads/ directory.`);
    }

    console.log(`=============================================================`);
    console.log(`  SYSTEM RESTORE COMPLETE SUCCESSFULLY!`);
    console.log(`=============================================================`);
  } catch (err) {
    console.error(`[RESTORE ERROR]: System restore failed`, err);
    throw err;
  }
}

if (process.argv[1]?.endsWith('restore.js')) {
  const targetFolder = process.argv[2];
  restoreSystemBackup(targetFolder).catch(console.error);
}
