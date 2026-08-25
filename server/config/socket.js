import { Server } from 'socket.io';
import { supabase } from '../database/supabaseClient.js';

let ioInstance = null;

export const initializeSocket = (httpServer) => {
  const io = new Server(httpServer, {
    cors: {
      origin: process.env.ALLOWED_ORIGIN || 'http://localhost:5173',
      methods: ['GET', 'POST'],
      credentials: true
    }
  });

  io.on('connection', (socket) => {
    console.log(`[SOCKET CONNECTED]: Client ID: ${socket.id}`);

    // Join room based on user role if available
    socket.on('join', (room) => {
      console.log(`[SOCKET ROOM JOIN]: Client ${socket.id} joined room: ${room}`);
      socket.join(room);
    });

    socket.on('disconnect', () => {
      console.log(`[SOCKET DISCONNECTED]: Client ID: ${socket.id}`);
    });
  });

  ioInstance = io;
  return io;
};

// Utility function to broadcast logs or status changes to connected clients
export const broadcastEvent = async (event, data) => {
  // Legacy Socket.io broadcast
  if (ioInstance) {
    ioInstance.emit(event, data);
  } else {
    console.warn('[SOCKET WARNING]: Cannot broadcast, Socket.IO instance not initialized');
  }

  // Supabase Realtime broadcast (Custom Event)
  try {
    const channel = supabase.channel('system_events');
    await channel.send({
      type: 'broadcast',
      event: event,
      payload: data
    });
  } catch (error) {
    console.error('[SUPABASE REALTIME ERROR]: Failed to broadcast event', error);
  }
};
