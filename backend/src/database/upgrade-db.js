import sqlite3 from 'sqlite3';
import { promisify } from 'util';

const dbPath = './database.sqlite';
const db = new sqlite3.Database(dbPath);
const run = promisify(db.run.bind(db));
const all = promisify(db.all.bind(db));

// Helper to generate a 128-float biometric face descriptor vector
const generateDescriptor = (name) => {
  const desc = [];
  const lower = name.toLowerCase();
  for (let i = 0; i < 128; i++) {
    let charVal = lower.charCodeAt(i % lower.length) / 128.0;
    desc.push(Math.sin(i * charVal) * 0.8 + 0.1);
  }
  return JSON.stringify(desc);
};

try {
  const employees = await all('SELECT id, name, email, face_data FROM employees');
  console.log('Checking face data for existing employees...');
  
  for (const emp of employees) {
    if (!emp.face_data) {
      console.log(`Updating face data for ${emp.name} (${emp.email})...`);
      const face = generateDescriptor(emp.name);
      await run('UPDATE employees SET face_data = ? WHERE id = ?', [face, emp.id]);
    }
  }
  
  console.log('Database upgrade completed successfully!');
} catch (error) {
  console.error('Error upgrading database:', error);
} finally {
  db.close();
}
