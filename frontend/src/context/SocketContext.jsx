import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { supabase } from '../services/supabaseClient.js';

const SocketContext = createContext(null);

export const SocketProvider = ({ children }) => {
  const [connected, setConnected] = useState(false);
  const listenersRef = useRef({});
  const channelRef = useRef(null);

  useEffect(() => {
    // Initialize Supabase Realtime Broadcast Channel
    console.log(`[REALTIME CONNECTING]: Initiating serverless Supabase Realtime channel...`);
    const channel = supabase.channel('system_events');

    channel
      .on('broadcast', { event: '*' }, (payload) => {
        const eventName = payload.event;
        const data = payload.payload;
        console.log(`[REALTIME BROADCAST RECEIVED]: Event: ${eventName}`, data);
        if (listenersRef.current[eventName]) {
          listenersRef.current[eventName].forEach(cb => {
            try {
              cb(data);
            } catch (err) {
              console.error(`[REALTIME CALLBACK EXCEPTION]:`, err);
            }
          });
        }
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log(`[REALTIME LIVE]: Supabase Realtime channel subscribed successfully.`);
          setConnected(true);
        } else {
          console.log(`[REALTIME STATUS CHANGE]: Status: ${status}`);
          if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
            setConnected(false);
          }
        }
      });

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        console.log(`[REALTIME DISCONNECTING]: Removing Supabase Realtime channel...`);
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, []);

  // Expose an interface compatible with legacy socket.on/off/emit
  const mockSocket = {
    on: (eventName, callback) => {
      if (!listenersRef.current[eventName]) {
        listenersRef.current[eventName] = [];
      }
      if (!listenersRef.current[eventName].includes(callback)) {
        listenersRef.current[eventName].push(callback);
      }
    },
    off: (eventName, callback) => {
      if (listenersRef.current[eventName]) {
        listenersRef.current[eventName] = listenersRef.current[eventName].filter(cb => cb !== callback);
      }
    },
    emit: async (eventName, payload) => {
      if (channelRef.current) {
        console.log(`[REALTIME EMITTING BROADCAST]: Event: ${eventName}`, payload);
        await channelRef.current.send({
          type: 'broadcast',
          event: eventName,
          payload: payload
        });
      } else {
        console.warn(`[REALTIME EMIT FAILED]: Channel not active. Event: ${eventName}`);
      }
    }
  };

  return (
    <SocketContext.Provider value={{ socket: mockSocket, connected }}>
      {children}
    </SocketContext.Provider>
  );
};

export const useSocket = () => useContext(SocketContext);
