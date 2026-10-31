import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Phone, Mail, MapPin, ShieldCheck, Clock, MessageCircle } from 'lucide-react';
import { scrollToTop } from '../hooks/useSmoothScroll';
import { pathForTab } from '../landingTabs';
import { useLanding } from '../landingContentContext';
import useAppModules from '../useAppModules';

const Footer = ({ setActiveTab }) => {
  const { contact: CONTACT, launchCities: LAUNCH_CITIES, waLink, brand, footer } = useLanding();
  const navigate = useNavigate();
  // The Services page lists the app's real modules, so the footer lists the
  // same ones — the hand-written CMS labels (SUV, Hotel & Mall…) had no card
  // to land on. The CMS list is only the fallback while/if modules don't load.
  const appModules = useAppModules();
  const cabServices = appModules.length
    ? appModules.map((m) => ({ label: m.title, service: m.title, fromModules: true }))
    : footer.cabServices || [];
  const handleNavClick = (id) => {
    setActiveTab(id);
    scrollToTop();
  };
  // Every service used to land on the top of /services, which looked like a
  // dead click — and was one when already on that page. The Services page
  // scrolls to and highlights the card named in `focus`.
  const handleServiceClick = (item) => {
    navigate(pathForTab('services'), {
      state: { focus: item.service || item.label, fromModules: Boolean(item.fromModules) },
    });
  };
  const legalLine = [
    footer.legalName,
    footer.cin && `CIN: ${footer.cin}`,
    footer.gstin && `GSTIN: ${footer.gstin}`,
  ].filter(Boolean);

  return (
    <footer className="footer-container">
      <div className="container">
        <div className="footer-top-grid">
          {/* Brand Info */}
          <div className="footer-brand">
            <div className="footer-logo">
              <img src={brand.logo} alt={`${brand.wordmarkPrimary} ${brand.wordmarkSecondary}`} className="footer-logo-img" />
              <div>
                <div className="footer-logo-text">
                  <span className="logo-zi">{brand.wordmarkPrimary}</span>
                  <span className="logo-cab">{brand.wordmarkSecondary}</span>
                </div>
                <p className="footer-tagline">{brand.tagline}</p>
              </div>
            </div>
            <p className="footer-desc">{footer.description}</p>

            <div className="footer-contacts">
              <div className="contact-item">
                <Phone size={16} color="#F5B400" />
                <span>
                  Call us:{' '}
                  <a href={`tel:${String(CONTACT.tollFree).replace(/[^\d+]/g, '')}`} className="footer-inline-link">
                    <strong>{CONTACT.tollFree}</strong>
                  </a>
                </span>
              </div>
              <div className="contact-item">
                <MessageCircle size={16} color="#F5B400" />
                <span>
                  WhatsApp:{' '}
                  <a href={waLink()} target="_blank" rel="noreferrer" className="footer-inline-link">
                    {CONTACT.whatsappDisplay}
                  </a>
                </span>
              </div>
              <div className="contact-item">
                <Mail size={16} color="#F5B400" />
                <span>
                  Email:{' '}
                  <a href={`mailto:${CONTACT.email}`} className="footer-inline-link">
                    {CONTACT.email}
                  </a>
                </span>
              </div>
              <div className="contact-item">
                <MapPin size={16} color="#F5B400" />
                <span>
                  Office:{' '}
                  {CONTACT.mapsUrl ? (
                    <a href={CONTACT.mapsUrl} target="_blank" rel="noreferrer" className="footer-inline-link">
                      {CONTACT.address}
                    </a>
                  ) : (
                    CONTACT.address
                  )}
                </span>
              </div>
              {footer.registeredOffice && (
                <div className="contact-item">
                  <MapPin size={16} color="#F5B400" />
                  <span>Registered Office: {footer.registeredOffice}</span>
                </div>
              )}
            </div>
          </div>

          {/* Quick Links */}
          <div className="footer-col">
            <h4 className="footer-heading">Quick Links</h4>
            <ul className="footer-links">
              <li><button onClick={() => handleNavClick('home')}>Home</button></li>
              <li><button onClick={() => handleNavClick('about')}>About Us</button></li>
              <li><button onClick={() => handleNavClick('services')}>Our Services</button></li>
              <li><button onClick={() => handleNavClick('corporate')}>Corporate Travel</button></li>
              <li><button onClick={() => handleNavClick('partner')}>Partner With Us</button></li>
              <li><button onClick={() => handleNavClick('driver')}>Attach Driver/Cab</button></li>
              <li><button onClick={() => handleNavClick('advertise')}>Advertise with Kranti Cabs</button></li>
              <li><button onClick={() => handleNavClick('contact')}>Contact Us</button></li>
            </ul>
          </div>

          {/* Our Services */}
          <div className="footer-col">
            <h4 className="footer-heading">{footer.servicesHeading}</h4>
            <ul className="footer-links">
              {cabServices.map((item, index) => (
                <li key={index}>
                  <button onClick={() => handleServiceClick(item)}>{item.label}</button>
                </li>
              ))}
            </ul>
          </div>

          {/* Mobile App & Safety */}
          <div className="footer-col">
            <h4 className="footer-heading">Download App</h4>
            <p className="footer-text-sm">{brand.appBlurb}</p>
            <div className="footer-app-badges">
              {/* Anchors only when a store URL is set — otherwise these stay the
                  inert badges they have always been, rather than dead links. */}
              {[
                { url: brand.playStoreUrl, title: 'GET IT ON', store: 'Google Play' },
                { url: brand.appStoreUrl, title: 'Download on the', store: 'App Store' },
              ].map((badge) => {
                const Tag = badge.url ? 'a' : 'div';
                const props = badge.url ? { href: badge.url, target: '_blank', rel: 'noreferrer' } : {};
                return (
                  <Tag key={badge.store} className="app-badge" {...props}>
                    <span className="app-badge-title">{badge.title}</span>
                    <span className="app-badge-store">{badge.store}</span>
                  </Tag>
                );
              })}
            </div>

            <div className="footer-trust-mini">
              {(footer.trustPills || []).map((pill, index) => {
                const PillIcon = index === 0 ? ShieldCheck : Clock;
                return (
                  <div className="trust-pill" key={index}>
                    <PillIcon size={14} color="#F5B400" />
                    <span>{pill.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="footer-cities">
          <span className="footer-cities-label">Now Live In:</span>
          {LAUNCH_CITIES.map((c) => (
            <span key={c.name} className="footer-city-pill">
              <MapPin size={12} color="#F5B400" /> {c.name}
            </span>
          ))}
        </div>

        {legalLine.length > 0 && (
          <p className="footer-legal">{legalLine.join('  •  ')}</p>
        )}

        <div className="footer-bottom">
          <p>{footer.copyright}</p>
          <div className="footer-bottom-links">
            {/* These were #privacy / #terms / #refund, which scrolled nowhere.
                The real routes have existed all along. */}
            <a href="/privacy">Privacy Policy</a>
            <span>•</span>
            <a href="/terms">Terms of Service</a>
            <span>•</span>
            <a href="/refund">Refund & Cancellation</a>
            <span>•</span>
            {/* Required credit for the Creative Commons vehicle photos.
                Safe to delete once they are replaced with Kranti Cabs' own fleet photos. */}
            <a href="/vehicles/ATTRIBUTION.md" target="_blank" rel="noreferrer">Photo Credits</a>
          </div>
        </div>
      </div>

      <style>{`
        .kranti-landing {
          .footer-container {
            background-color: #0A0A0B;
            color: #A6A6A3;
            padding-top: 60px;
            padding-bottom: 24px;
            border-top: 1px solid rgba(255, 255, 255, 0.08);
            margin-top: auto;
          }

          .footer-top-grid {
            display: grid;
            grid-template-columns: 1.4fr 1fr 1fr 1.2fr;
            gap: 40px;
            margin-bottom: 50px;
          }

          .footer-logo {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 14px;
          }

          .footer-logo-img {
            width: 54px;
            height: 54px;
            border-radius: 13px;
            object-fit: cover;
          }

          .footer-logo-text {
            display: flex;
            align-items: baseline;
          }

          .footer-inline-link:hover {
            color: #F5B400;
          }

          .footer-cities {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 10px;
            padding-bottom: 24px;
          }

          .footer-cities-label {
            font-size: 13px;
            font-weight: 600;
            color: #FFFFFF;
          }

          .footer-city-pill {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            background: rgba(245, 180, 0, 0.1);
            border: 1px solid rgba(245, 180, 0, 0.3);
            color: #D6D6D3;
            font-size: 12.5px;
            font-weight: 500;
            padding: 5px 12px;
            border-radius: 20px;
          }

          .footer-logo .logo-zi {
            font-size: 28px;
            font-weight: 800;
            color: #FFFFFF;
            font-style: italic;
          }

          .footer-logo .logo-cab {
            font-size: 24px;
            font-weight: 800;
            color: #F5B400;
            margin-left: 4px;
          }

          .footer-tagline {
            color: #F5B400;
            font-size: 12.5px;
            font-weight: 500;
          }

          .footer-desc {
            font-size: 13.5px;
            line-height: 1.6;
            color: #A6A6A3;
            margin-bottom: 20px;
          }

          .footer-contacts {
            display: flex;
            flex-direction: column;
            gap: 10px;
          }

          .contact-item {
            display: flex;
            align-items: center;
            gap: 10px;
            font-size: 13px;
            color: #D6D6D3;
          }

          .contact-item strong {
            color: #FFFFFF;
          }

          .footer-heading {
            color: #FFFFFF;
            font-size: 17px;
            font-weight: 600;
            margin-bottom: 20px;
            position: relative;
          }

          .footer-heading::after {
            content: '';
            position: absolute;
            left: 0;
            bottom: -6px;
            width: 24px;
            height: 2px;
            background-color: #F5B400;
            border-radius: 2px;
          }

          .footer-links {
            list-style: none;
            padding: 0;
            display: flex;
            flex-direction: column;
            gap: 10px;
          }

          .footer-links button {
            background: none;
            border: none;
            color: #A6A6A3;
            font-size: 14px;
            cursor: pointer;
            padding: 0;
            text-align: left;
            transition: all 0.2s;
          }

          .footer-links button:hover {
            color: #F5B400;
            padding-left: 4px;
          }

          .footer-text-sm {
            font-size: 13.5px;
            line-height: 1.5;
            margin-bottom: 16px;
          }

          .footer-app-badges {
            display: flex;
            gap: 10px;
            margin-bottom: 20px;
          }

          .app-badge {
            background: rgba(255, 255, 255, 0.06);
            border: 1px solid rgba(255, 255, 255, 0.12);
            border-radius: 8px;
            padding: 8px 12px;
            cursor: pointer;
            transition: var(--transition);
          }

          .app-badge:hover {
            background: rgba(245, 180, 0, 0.15);
            border-color: #F5B400;
          }

          .app-badge-title {
            display: block;
            font-size: 9px;
            color: #A6A6A3;
            text-transform: uppercase;
            letter-spacing: 0.5px;
          }

          .app-badge-store {
            display: block;
            font-size: 12.5px;
            font-weight: 600;
            color: #FFFFFF;
          }

          .footer-trust-mini {
            display: flex;
            gap: 12px;
          }

          .trust-pill {
            display: flex;
            align-items: center;
            gap: 6px;
            background: rgba(17, 17, 19, 0.8);
            padding: 6px 12px;
            border-radius: 20px;
            font-size: 11.5px;
            color: #D6D6D3;
          }

          .footer-legal {
            font-size: 12px;
            color: #8A8A87;
            letter-spacing: 0.2px;
            padding-bottom: 16px;
            word-break: break-word;
          }

          .footer-bottom {
            border-top: 1px solid rgba(255, 255, 255, 0.08);
            padding-top: 24px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: 13px;
          }

          .footer-bottom-links {
            display: flex;
            gap: 12px;
            align-items: center;
          }

          .footer-bottom-links a {
            color: #A6A6A3;
            transition: color 0.2s;
          }

          .footer-bottom-links a:hover {
            color: #F5B400;
          }

          @media (max-width: 992px) {
            .footer-top-grid {
              grid-template-columns: 1fr 1fr;
            }
          }

          @media (max-width: 768px) {
            .footer-container {
              padding-top: 40px;
            }
            .footer-top-grid {
              gap: 30px;
              margin-bottom: 30px;
            }
          }

          @media (max-width: 576px) {
            .footer-top-grid {
              grid-template-columns: 1fr;
            }
            .footer-bottom {
              flex-direction: column;
              gap: 12px;
              text-align: center;
            }
            .footer-bottom-links {
              flex-wrap: wrap;
              justify-content: center;
            }
            .footer-logo-img {
              width: 46px;
              height: 46px;
            }
            .contact-item {
              align-items: flex-start;
            }
            /* 21px-tall text links are too small to tap reliably */
            .footer-links button {
              padding: 6px 0;
            }
          }
      
        }
      `}</style>
    </footer>
  );
};

export default Footer;
