// The landing page has its own minimal route tree. Every other path loads the
// full console/docs router, so an anonymous home visit never downloads route
// definitions and shared modules for dozens of authenticated screens.
if (window.location.pathname === '/') {
  void import('./landing-main');
} else {
  void import('./main');
}
