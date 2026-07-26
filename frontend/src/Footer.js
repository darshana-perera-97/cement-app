import { useLocation } from 'react-router-dom';
import { useShopName } from './shopConfig';

function Footer() {
  const year = new Date().getFullYear();
  const { pathname } = useLocation();
  const shopName = useShopName();
  const dashboard = pathname.startsWith('/dashboard');

  return (
    <footer
      className={`shrink-0 border-t border-slate-200/80 bg-white/80 py-3 text-center text-[11px] font-medium text-slate-500 backdrop-blur-sm sm:text-xs ${
        dashboard
          ? 'md:pl-[260px] lg:pr-[300px] xl:pr-[320px]'
          : ''
      }`}
      role="contentinfo"
    >
      <p className="px-3 leading-relaxed sm:px-4">
        <span className="block sm:inline">© {year} {shopName} — Cement supply.</span>{' '}
        <span className="block sm:inline">All rights reserved.</span>
      </p>
    </footer>
  );
}

export default Footer;
