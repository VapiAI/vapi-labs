import type { WorkshopSlideViewProps } from "./types";

export function WorkshopSlideView({
  processLabel,
  slide,
}: WorkshopSlideViewProps) {
  return (
    <article
      className={`workshop-slide slide-tone-${slide.tone}`}
      aria-labelledby="slide-title"
    >
      <div className="slide-heading">
        <span className="slide-eyebrow">{slide.eyebrow}</span>
        <h1 id="slide-title">{slide.title}</h1>
        <p>{slide.lead}</p>
      </div>

      {slide.flow && (
        <div className="slide-flow" aria-label={processLabel}>
          {slide.flow.map((step, index) => (
            <div className="slide-flow-step" key={step}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{step}</strong>
            </div>
          ))}
        </div>
      )}

      {slide.cards && (
        <div className={`slide-card-grid slide-card-grid-${slide.cards.length}`}>
          {slide.cards.map((card) => (
            <section className="slide-card" key={card.title}>
              {card.eyebrow && <span>{card.eyebrow}</span>}
              <h2>{card.title}</h2>
              <p>{card.body}</p>
            </section>
          ))}
        </div>
      )}

      {slide.prompt && (
        <blockquote className="slide-prompt">“{slide.prompt}”</blockquote>
      )}

      {slide.resources && (
        <div className="slide-resources">
          {slide.resources.map((resource) => (
            <a
              href={resource.href}
              key={resource.href}
              rel="noreferrer"
              target="_blank"
            >
              <span>{resource.label}</span>
              <p>{resource.description}</p>
              <strong aria-hidden="true">↗</strong>
            </a>
          ))}
        </div>
      )}

      {slide.note && <p className="slide-note">{slide.note}</p>}
      {slide.statement && (
        <p className="slide-statement">{slide.statement}</p>
      )}
    </article>
  );
}
