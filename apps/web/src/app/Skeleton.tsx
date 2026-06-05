// Loading skeletons. They reuse the `.sq-*` classes defined inline in
// index.html's <head>, so the pre-React boot paint and these React states share
// one silhouette — the hand-off is seamless, no spinner flash.
//
// AppShellSkeleton: full shell (sidebar + content), shown while the session is
// still loading and the real Layout isn't mounted yet. Mirrors index.html #root.
// PageSkeleton: content-only, shown as the Suspense fallback for lazy route
// pages — the Layout (and real sidebar) is already mounted around it.

const NAV_ITEMS = 8;

function ContentSkeleton() {
  return (
    <>
      <div className="sq-hd">
        <div className="sq-hd-txt">
          <div className="sq-hd-title sq-b" />
          <div className="sq-hd-sub sq-b" />
        </div>
        <div className="sq-hd-act sq-b" />
      </div>
      <div className="sq-bd">
        <div className="sq-cards">
          <div className="sq-card sq-b" />
          <div className="sq-card sq-b" />
          <div className="sq-card sq-b" />
          <div className="sq-card sq-b" />
        </div>
        <div className="sq-panel sq-b" />
      </div>
    </>
  );
}

export function AppShellSkeleton() {
  return (
    <div className="sq-shell" aria-busy="true" aria-label="Caricamento">
      <div className="sq-rail">
        <div className="sq-rail-brand">
          <div className="sq-rail-logo sq-b" />
          <div className="sq-rail-brandtxt">
            <span className="sq-b" />
            <span className="sq-b" />
          </div>
        </div>
        <div className="sq-rail-nav">
          {Array.from({ length: NAV_ITEMS }, (_, i) => (
            <div key={i} className="sq-rail-item sq-b" />
          ))}
        </div>
        <div className="sq-rail-foot">
          <div className="sq-rail-avatar sq-b" />
          <div className="sq-rail-lines">
            <span className="sq-b" />
            <span className="sq-b" />
          </div>
        </div>
      </div>
      <div className="sq-main">
        <ContentSkeleton />
      </div>
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="sq-page" aria-busy="true" aria-label="Caricamento">
      <ContentSkeleton />
    </div>
  );
}
