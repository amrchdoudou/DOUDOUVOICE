import { Link } from 'react-router-dom';

export default function Footer() {
  return (
    <footer className="w-full py-8 px-6 border-t border-white/5 mt-auto">
      <div className="max-w-6xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
        <div className="text-white/40 text-sm">
          &copy; {new Date().getFullYear()} DoudouVoice. All rights reserved.
        </div>
        <div className="flex gap-6 text-sm text-white/60">
          <Link to="/terms" className="hover:text-white transition-colors">Terms of Service</Link>
          <Link to="/privacy" className="hover:text-white transition-colors">Privacy Policy</Link>
          <Link to="/refund" className="hover:text-white transition-colors">Refund Policy</Link>
        </div>
      </div>
    </footer>
  );
}
