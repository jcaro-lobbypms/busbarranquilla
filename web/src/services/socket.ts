import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

export const getSocket = (): Socket => {
  if (!socket) {
    // En producción (Vercel) conecta directo al backend porque Vercel no proxea WS.
    // En dev/Docker, string vacío → mismo origen (proxy de Vite o Nginx).
    const apiUrl = import.meta.env.VITE_API_URL ?? '';
    socket = io(apiUrl, { path: '/socket.io' });
  }
  return socket;
};

export const disconnectSocket = (): void => {
  socket?.disconnect();
  socket = null;
};
