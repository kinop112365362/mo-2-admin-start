import { handlers } from '@/auth';
import { authOptions } from './core';

export const { GET, POST } = handlers(authOptions);
