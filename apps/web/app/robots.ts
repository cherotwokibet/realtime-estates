import { publicRobots } from '../lib/public-seo';
import { publicSeoPolicy } from '../lib/public-seo-server';
export const dynamic = 'force-dynamic';
export default function robots() {
  return publicRobots(publicSeoPolicy);
}
