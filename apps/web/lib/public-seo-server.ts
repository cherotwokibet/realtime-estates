import 'server-only';
import { resolvePublicSeoPolicy } from './public-seo';
export const publicSeoPolicy = resolvePublicSeoPolicy(process.env);
