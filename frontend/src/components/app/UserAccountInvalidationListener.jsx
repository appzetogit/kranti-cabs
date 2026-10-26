import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { socketService } from '../../shared/api/socket';
import { clearLocalUserSession } from '../../modules/user/services/authService';
import { clearCurrentRide } from '../../modules/user/services/currentRideService';

const clearUserSession = () => {
  clearCurrentRide();
  clearLocalUserSession();
};

const UserAccountInvalidationListener = () => {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const isAdminRoute = location.pathname.startsWith('/admin');
    const isUserRoute =
      !isAdminRoute &&
      !location.pathname.startsWith('/user-import') &&
      !location.pathname.startsWith('/driver-import') &&
      !location.pathname.startsWith('/owner') &&
      !location.pathname.startsWith('/taxi/driver');

    // Admin pages listen too: an expired admin login used to leave the panel
    // on "Communication Gateway Offline" with every figure at 0, because the
    // admin branch below was never reached on an /admin route.
    if (!isUserRoute && !isAdminRoute) {
      return undefined;
    }

    const handleLogout = (loginState = null) => {
      clearUserSession();
      socketService.disconnect();
      navigate('/taxi/user/login', { replace: true, state: loginState });
    };

    const handleAuthStale = (event) => {
      const staleToken = event.detail?.token || '';
      const currentUserToken =
        localStorage.getItem('userToken') || localStorage.getItem('token') || '';
      const currentAdminToken = localStorage.getItem('adminToken') || '';

      if (
        isUserRoute &&
        event.detail?.role === 'user' &&
        (!staleToken || staleToken === currentUserToken)
      ) {
        handleLogout(event.detail?.message ? { error: event.detail.message } : null);
        return;
      }

      // The token may already have been cleared by the time this runs, so a
      // missing admin token counts as stale too.
      if (
        event.detail?.role === 'admin' &&
        (!staleToken || !currentAdminToken || staleToken === currentAdminToken) &&
        !location.pathname.startsWith('/admin/login')
      ) {
        socketService.disconnect();
        navigate('/admin/login', { replace: true });
      }
    };

    window.addEventListener('app:auth-stale', handleAuthStale);

    return () => {
      window.removeEventListener('app:auth-stale', handleAuthStale);
    };
  }, [location.pathname, navigate]);

  return null;
};

export default UserAccountInvalidationListener;
