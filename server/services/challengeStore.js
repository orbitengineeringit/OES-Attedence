import { getDb } from '../database/db.js';

export const challengeStore = {
  async set(sessionId, challengeType) {
    const db = getDb();
    const now = Date.now();
    
    // Prune expired sessions older than 60 seconds
    try {
      await db.run(`DELETE FROM challenge_nonces WHERE created_at < ?`, [now - 60000]);
    } catch (err) {
      console.error('[CHALLENGE PRUNE ERROR]:', err);
    }
    
    await db.run(
      `INSERT INTO challenge_nonces (session_id, challenge_type, created_at) VALUES (?, ?, ?)`,
      [sessionId, challengeType, now]
    );
  },

  async get(sessionId) {
    const db = getDb();
    try {
      const session = await db.get(
        `SELECT challenge_type, created_at FROM challenge_nonces WHERE session_id = ?`,
        [sessionId]
      );
      if (!session) return null;
      return {
        challengeType: session.challenge_type,
        createdAt: Number(session.created_at)
      };
    } catch (err) {
      console.error('[CHALLENGE GET ERROR]:', err);
      return null;
    }
  },

  async delete(sessionId) {
    const db = getDb();
    try {
      await db.run(`DELETE FROM challenge_nonces WHERE session_id = ?`, [sessionId]);
    } catch (err) {
      console.error('[CHALLENGE DELETE ERROR]:', err);
    }
  }
};
