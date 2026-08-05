import sqlite3 from 'sqlite3';
import { promisify } from 'util';

const db = new sqlite3.Database('./database.sqlite');
const get = promisify(db.get.bind(db));
const all = promisify(db.all.bind(db));

try {
  const count = await get("SELECT COUNT(*) as count FROM employees");
  console.log("Total Employees Count:", count.count);
  
  const employees = await all("SELECT id, name, email, role, department FROM employees");
  console.log("Employees List:");
  console.dir(employees);
} catch (err) {
  console.error("Error reading database:", err);
} finally {
  db.close();
}
