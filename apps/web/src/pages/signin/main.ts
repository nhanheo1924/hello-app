import { registerLegacyGlobals } from '../../legacy/register-globals';

registerLegacyGlobals();
await import('../../../signin/signin.js');
