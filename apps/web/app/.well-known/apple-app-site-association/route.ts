import { readPropertyAssociation } from '../../../lib/property-app-link-associations.ts';

export const dynamic = 'force-dynamic';
export const GET = () => readPropertyAssociation('ios', process.env);
