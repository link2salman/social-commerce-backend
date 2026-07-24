import { Router } from 'express';
import { protect } from '@middlewares/auth';
import authRoutes from './authRoutes';
import feedRoutes from './feedRoutes';
import userRoutes from './userRoutes';
import videoRoutes from './videoRoutes';
import commentRoutes from './commentRoutes';
import reportRoutes from './reportRoutes';
import productRoutes from './productRoutes';
import sellerRoutes from './sellerRoutes';
import cartRoutes from './cartRoutes';
import orderRoutes from './orderRoutes';
import conversationRoutes from './conversationRoutes';
import eventRoutes from './eventRoutes';
import callRoutes from './callRoutes';
import uploadRoutes from './uploadRoutes';
import deviceRoutes from './deviceRoutes';
import notificationRoutes from './notificationRoutes';
import moderationRoutes from './moderationRoutes';
import searchRoutes from './searchRoutes';
import { getFriendRequests } from '@controllers/userController';

// Aggregate every domain router under one mount. app.ts mounts this at the
// API prefix (/v1) — the path the mobile client's API_URL points at.
const api = Router();

api.use('/auth', authRoutes);
api.use('/feed', feedRoutes);

// Top-level collection (not under /users) — incoming friend requests.
api.get('/friend-requests', protect, getFriendRequests);

api.use('/users', userRoutes);
api.use('/videos', videoRoutes);
api.use('/comments', commentRoutes);
api.use('/reports', reportRoutes);
api.use('/products', productRoutes);
api.use('/sellers', sellerRoutes);
api.use('/cart', cartRoutes);
api.use('/orders', orderRoutes);
api.use('/conversations', conversationRoutes);
api.use('/events', eventRoutes);
api.use('/calls', callRoutes);
api.use('/uploads', uploadRoutes);
api.use('/devices', deviceRoutes);
api.use('/notifications', notificationRoutes);
api.use('/search', searchRoutes);
api.use('/admin', moderationRoutes);

export default api;
