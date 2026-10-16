import { Route, useOutletContext } from 'react-router-dom';
import LandingShell from './LandingShell';
import { LANDING_TABS } from './landingTabs';
import Home from './pages/Home';
import AboutUs from './pages/AboutUs';
import Services from './pages/Services';
import Corporate from './pages/Corporate';
import Partner from './pages/Partner';
import Driver from './pages/Driver';
import Advertise from './pages/Advertise';
import ContactUs from './pages/ContactUs';

/**
 * The landing pages take `openBookingModal` / `setActiveTab` as props, from when
 * they were a standalone tab-driven app. LandingShell puts both on the outlet
 * context, and this adapter feeds them back in as props — so the pages stay
 * unmodified and portable.
 */
const withShellContext = (Component) => {
  const Wrapped = () => <Component {...(useOutletContext() ?? {})} />;
  Wrapped.displayName = `LandingRoute(${Component.name})`;
  return Wrapped;
};

const PAGES = {
  home: withShellContext(Home),
  about: withShellContext(AboutUs),
  services: withShellContext(Services),
  corporate: withShellContext(Corporate),
  partner: withShellContext(Partner),
  driver: withShellContext(Driver),
  advertise: withShellContext(Advertise),
  contact: withShellContext(ContactUs),
};

// Paths come from LANDING_TABS so the nav highlighting and the router can never
// drift apart.
const landingRoutes = (
  <Route element={<LandingShell />}>
    {LANDING_TABS.map(({ id, path }) => {
      const Page = PAGES[id];
      return <Route key={id} path={path} element={<Page />} />;
    })}
  </Route>
);

export default landingRoutes;
