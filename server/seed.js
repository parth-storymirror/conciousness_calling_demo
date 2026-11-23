// Default content so the admin starts with what the website already shows. Only fills in what is empty.
const DEFAULT_BANNER = { enabled: false, speed: "normal", items: [] };

const DEFAULT_WRITINGS = [
  { type: "image", data: { url: "/assets/img/writing-five-living-movements.jpg", alt: "Artwork titled Consciousness Calling, The Five Living Movements, One Consciousness, an Ever-Unfolding Journey: five meditating figures rising on lotuses along a spiral of golden light, labelled 01 Consciousness Calling, 02 Consciousness Revealing, 03 Consciousness Living, 04 Consciousness Embodied and 05 The Great Remembering.", caption: "", size: "medium", fileId: null } },
  { type: "title", data: { text: "CONSCIOUSNESS CALLING", subtitle: "The Larger Body of Work" } },
  { type: "text", data: { text: "Consciousness Calling is an evolving body of books, contemplative writing and Light Code artwork exploring how inner recognition becomes conscious living, embodiment and service. Each work carries its own inquiry, while participating in the same Five Living Movements." } },
  {
    type: "text",
    data: {
      text: [
        "CONSCIOUSNESS CALLING — The Soul begins to hear.",
        "CONSCIOUSNESS REVEALING — What was hidden becomes recognizable through living symbol and experience.",
        "CONSCIOUSNESS LIVING — Recognition enters ordinary Life.",
        "CONSCIOUSNESS EMBODIED — Consciousness is increasingly lived through the human being.",
        "THE GREAT REMEMBERING — Recognition expands toward embodiment, service and humanity.",
      ].join("\n\n"),
    },
  },
  {
    type: "table",
    data: {
      title: "Future writings:",
      headers: ["Body of work", "Central exploration", "Essential recognition"],
      rows: [
        ["Book 01 — Living with I AM Presence", "From individual awareness toward Oneness", "Consciousness is recognized within."],
        ["Book 02 — Inner Sun: Shiva Śakti Field", "Presence, Śakti, the Heart and the Living Field", "Consciousness is revealed as living Presence and Movement."],
        ["Book 03 — Human Ascension Map", "Human awakening, integration and embodiment", "Consciousness becomes increasingly recognized and lived through the human experience."],
        ["Consciousness Revelations — Beyond Time", "Cosmic cycles and conscious evolution", "Time measures change; humanity can consciously participate in its unfolding."],
        ["Consciousness Revelations — The Universal Living Heart", "The eternal Movement of Śakti throughout creation", "Divine Love is already expressing within and throughout Life."],
      ],
      firstColumnBold: true,
    },
  },
];

async function seedDefaults(data) {
  if ((await data.writings.count()) === 0) {
    for (const b of DEFAULT_WRITINGS) await data.writings.add(b.type, b.data);
  }
  if ((await data.settings.get("banner", null)) === null) await data.settings.set("banner", DEFAULT_BANNER);
}

module.exports = { seedDefaults, DEFAULT_BANNER, DEFAULT_WRITINGS };
