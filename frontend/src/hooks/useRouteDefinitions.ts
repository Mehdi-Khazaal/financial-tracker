import { APP_ROUTES, LEGACY_REDIRECTS } from '../lib/routes';

export const useRouteDefinitions = () => {
  return {
    appRoutes: APP_ROUTES,
    legacyRedirects: LEGACY_REDIRECTS,
  };
};
