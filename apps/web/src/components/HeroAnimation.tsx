import './HeroAnimation.css';

export function HeroAnimation() {
  return (
    <div className="hero-anim">
      <div className="hero-anim__bg" />
      <svg className="hero-anim__blob hero-anim__blob--1" viewBox="0 0 200 200" aria-hidden>
        <circle cx="100" cy="100" r="100" fill="rgba(255,255,255,0.10)" />
      </svg>
      <svg className="hero-anim__blob hero-anim__blob--2" viewBox="0 0 200 200" aria-hidden>
        <circle cx="100" cy="100" r="100" fill="rgba(255,255,255,0.08)" />
      </svg>

      <div className="hero-anim__content">
        <h1 className="hero-anim__brand">ciSono</h1>
        <p className="hero-anim__payoff">Il tempo che lavori, semplice come dirlo.</p>

        <div className="hero-anim__stage">
          <ClockCard />
          <StampPill kind="in" label="Ingresso" time="08:02" delay="0s" />
          <StampPill kind="break" label="Inizio pausa" time="13:00" delay="2.4s" />
          <StampPill kind="out" label="Uscita" time="17:48" delay="4.8s" />
          <GpsMarker />
        </div>
      </div>
    </div>
  );
}

function ClockCard() {
  return (
    <svg className="hero-anim__clock" viewBox="0 0 120 120" aria-hidden>
      <circle cx="60" cy="60" r="54" fill="#fff" opacity="0.95" />
      <circle cx="60" cy="60" r="54" fill="none" stroke="rgba(0,0,0,0.05)" strokeWidth="2" />
      {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((i) => {
        const angle = (i * 30 * Math.PI) / 180;
        const x1 = 60 + Math.sin(angle) * 46;
        const y1 = 60 - Math.cos(angle) * 46;
        const x2 = 60 + Math.sin(angle) * 50;
        const y2 = 60 - Math.cos(angle) * 50;
        return (
          <line
            key={i}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke="#b25500"
            strokeOpacity={i % 3 === 0 ? 0.9 : 0.35}
            strokeWidth={i % 3 === 0 ? 2.5 : 1.5}
            strokeLinecap="round"
          />
        );
      })}
      <g className="hero-anim__clock-hour">
        <line x1="60" y1="60" x2="60" y2="28" stroke="#5a2a00" strokeWidth="3.5" strokeLinecap="round" />
      </g>
      <g className="hero-anim__clock-minute">
        <line x1="60" y1="60" x2="60" y2="20" stroke="#b25500" strokeWidth="2.5" strokeLinecap="round" />
      </g>
      <circle cx="60" cy="60" r="3.5" fill="#5a2a00" />
    </svg>
  );
}

function StampPill({
  kind,
  label,
  time,
  delay,
}: {
  kind: 'in' | 'break' | 'out';
  label: string;
  time: string;
  delay: string;
}) {
  return (
    <div className={`hero-anim__pill hero-anim__pill--${kind}`} style={{ animationDelay: delay }}>
      <span className="hero-anim__pill-dot" />
      <span className="hero-anim__pill-label">{label}</span>
      <span className="hero-anim__pill-time">{time}</span>
    </div>
  );
}

function GpsMarker() {
  return (
    <div className="hero-anim__gps" aria-hidden>
      <span className="hero-anim__gps-ring" />
      <span className="hero-anim__gps-ring hero-anim__gps-ring--delay" />
      <svg viewBox="0 0 24 24" className="hero-anim__gps-pin">
        <path
          d="M12 2C7.6 2 4 5.6 4 10c0 5.5 7 11.5 7.3 11.7.4.3.9.3 1.3 0C13 21.5 20 15.5 20 10c0-4.4-3.6-8-8-8zm0 11a3 3 0 110-6 3 3 0 010 6z"
          fill="#fff"
        />
      </svg>
    </div>
  );
}
