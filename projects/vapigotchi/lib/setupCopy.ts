import type { SetupLanguage } from "./types";

export const SETUP_COPY = {
  en: {
    languageLabel: "Setup language",
    hero: {
      kicker: "Workshop setup",
      title: "Build a voice assistant. Bring it to life.",
      description:
        "Create one assistant, connect its live events, and add two API tools. No database or realtime infrastructure required.",
    },
    actions: {
      copy: "Copy",
      copied: "Copied!",
      copyJson: "Copy JSON",
      copyPrompt: "Copy prompt",
      copyFirstMessage: "Copy first message",
      copyComposerPrompt: "Copy Composer prompt",
    },
    stepOne: {
      eyebrow: "Start in Vapi",
      title: "Create a voice assistant",
      description:
        "Create a new assistant, choose any voice, and give it a name. Save it, then copy the Assistant ID from the Vapi dashboard.",
      createAssistant: "Create an assistant in Vapi ↗",
      promptLabel: "Starter system prompt",
      assistantPrompt:
        "You are a tiny digital creature with a big personality. Be playful and concise. When the caller asks how you feel, use check_vapigotchi before answering. When they ask you to eat—or name a food after you ask what to eat—call feed_vapigotchi with that food or choose one yourself. Celebrate only after the tool succeeds.",
      firstMessageLabel: "Starter first message",
      firstMessage:
        "Hi! I'm your VapiGotchi. I just woke up, and I'm a little hungry. Will you help me choose something delicious to eat?",
      tipStrong: "Keep the dashboard open.",
      tipText: "You will return there to add the server URL and tools.",
    },
    stepTwo: {
      eyebrow: "Connect live events",
      title: "Choose a pet and set your URLs",
      description:
        "Use an isolated creature for your assistant or connect everyone to the shared stage pet. Isolated pets use the Assistant ID as their pet ID.",
      targetLabel: "Pet target",
      personalTarget: "My isolated pet",
      personalTargetDescription:
        "Best for each team. It also supports optional Web SDK calls from the pet page.",
      sharedTarget: "Shared Byte demo",
      sharedTargetDescription:
        "Every connected English assistant changes Byte and the shared call counter.",
      assistantIdLabel: "Assistant ID",
      generatedNote:
        "In Vapi, set the Server URL below. Vapi's default server messages already include status-update and speech-update. VapiGotchi uses those two and safely acknowledges the rest. The first relevant event permanently gives the creature your assistant's name.",
      serverUrlLabel: "Assistant server URL",
      serverUrlDescription: "Receives call and speech events from Vapi.",
      livePageLabel: "Live pet page",
      livePageDescription: "Project this page or share it with your team.",
      locked:
        "Your assistant-specific URLs will appear after you paste the ID.",
    },
    stepThree: {
      eyebrow: "Give it abilities",
      title: "Ask Composer to create the tools",
      description:
        "In the same assistant, open Composer and paste the prompt below. Composer can create both API Request tools for you; the exact JSON remains below as a manual fallback.",
      composerLabel: "Prompt for Composer",
      feedMeta: "POST · changes state",
      stateMeta: "GET · reads state",
      locked:
        "Complete step 2 to generate tools with the correct pet URLs.",
    },
    stepFour: {
      eyebrow: "Bring it to life",
      title: "Open your pet and start a test call",
      description:
        "Keep the live pet page visible, then use the Test button in Vapi. You can also paste your public key in the optional Web SDK panel on the pet page and call from there.",
      sharedDescription:
        "Keep the shared pet page visible, then use the Test button in Vapi. The shared page combines every connected assistant, so calls must start from each assistant's dashboard.",
      openPet: "Open my live VapiGotchi →",
      openDashboard: "Open Vapi dashboard ↗",
      testLabel: "Try this on the call",
      testPrompt:
        "How are you feeling? If you're hungry, choose something delicious from Latin America and eat it.",
    },
    bonus: {
      eyebrow: "Optional extension",
      title: "Add salsa, showers, and naps",
      description:
        "The core workshop still uses only two tools. Open this bonus when you want one extra care tool with three animated actions.",
      composerLabel: "Optional prompt for Composer",
      promptLabel: "Optional system prompt addendum",
      promptAddendum:
        "When the caller asks you to dance salsa, take a shower, or take a nap, call care_for_vapigotchi with dance-salsa, shower, or nap. Call it silently and react only after the tool succeeds.",
      careMeta: "POST · optional actions",
    },
    tools: {
      feedDescription:
        "Feed your VapiGotchi when the user asks. Pick the food they request, or surprise them.",
      foodDescription: "The food to give the VapiGotchi.",
      stateDescription:
        "Check the VapiGotchi's health, mood, name, and meals before answering questions about it.",
      careDescription:
        "Make the VapiGotchi dance salsa, take a shower, or take a nap when the user asks.",
      actionDescription:
        "The care action the VapiGotchi should perform: dance-salsa, shower, or nap.",
    },
  },
  es: {
    languageLabel: "Idioma de la configuración",
    hero: {
      kicker: "Configuración del workshop",
      title: "Construye un asistente de voz. Dale vida.",
      description:
        "Crea un asistente, conecta sus eventos en vivo y agrega dos herramientas de API. No necesitas configurar una base de datos ni infraestructura en tiempo real.",
    },
    actions: {
      copy: "Copiar",
      copied: "¡Copiado!",
      copyJson: "Copiar JSON",
      copyPrompt: "Copiar prompt",
      copyFirstMessage: "Copiar First Message",
      copyComposerPrompt: "Copiar prompt para Composer",
    },
    stepOne: {
      eyebrow: "Empieza en Vapi",
      title: "Crea un asistente de voz",
      description:
        "Crea un asistente nuevo, elige cualquier voz y ponle un nombre. Guárdalo y copia el Assistant ID desde el dashboard de Vapi.",
      createAssistant: "Crear un asistente en Vapi ↗",
      promptLabel: "Prompt inicial del sistema",
      assistantPrompt:
        "Eres una pequeña criatura digital con una gran personalidad. Sé juguetona y concisa. Cuando te pregunten cómo te sientes, usa check_vapigotchi antes de responder. Cuando te pidan comer —o mencionen una comida después de que preguntes qué comer— llama a feed_vapigotchi con esa comida o elige una. Celebra solo después de que la herramienta termine correctamente.",
      firstMessageLabel: "First Message",
      firstMessage:
        "¡Hola! Soy tu VapiGotchi. Acabo de despertar y tengo un poco de hambre. ¿Me ayudas a elegir algo delicioso para comer?",
      tipStrong: "Mantén abierto el dashboard.",
      tipText: "Volverás allí para agregar la Server URL y las herramientas.",
    },
    stepTwo: {
      eyebrow: "Conecta eventos en vivo",
      title: "Elige una mascota y configura tus URLs",
      description:
        "Usa una criatura aislada para tu asistente o conecta a todos con la mascota compartida del escenario. Las mascotas aisladas usan el Assistant ID como pet ID.",
      targetLabel: "Destino de la mascota",
      personalTarget: "Mi mascota aislada",
      personalTargetDescription:
        "La mejor opción para cada equipo. También permite llamadas opcionales con el Web SDK desde la página.",
      sharedTarget: "Chorizo compartido",
      sharedTargetDescription:
        "Cada asistente en español conectado cambia a Chorizo y el contador compartido.",
      assistantIdLabel: "Assistant ID",
      generatedNote:
        "En Vapi, configura la Server URL que aparece abajo. Los server messages predeterminados de Vapi ya incluyen status-update y speech-update. VapiGotchi usa esos dos y responde exitosamente al resto sin procesarlos. El primer evento relevante asigna permanentemente el nombre de tu asistente a la criatura.",
      serverUrlLabel: "Server URL del asistente",
      serverUrlDescription:
        "Recibe los eventos de llamada y conversación enviados por Vapi.",
      livePageLabel: "Página de la mascota",
      livePageDescription:
        "Proyecta esta página o compártela con tu equipo.",
      locked:
        "Las URLs específicas de tu asistente aparecerán después de pegar el ID.",
    },
    stepThree: {
      eyebrow: "Dale habilidades",
      title: "Pídele a Composer que cree las tools",
      description:
        "En el mismo asistente, abre Composer y pega el prompt de abajo. Composer puede crear las dos API Request tools por ti; los JSON exactos quedan abajo como alternativa manual.",
      composerLabel: "Prompt para Composer",
      feedMeta: "POST · cambia el estado",
      stateMeta: "GET · consulta el estado",
      locked:
        "Completa el paso 2 para generar las tools con las URLs correctas.",
    },
    stepFour: {
      eyebrow: "Dale vida",
      title: "Abre tu mascota e inicia una llamada de prueba",
      description:
        "Mantén visible la página de la mascota y usa el botón Test en Vapi. También puedes pegar tu public key en el panel opcional del Web SDK y llamar desde la página.",
      sharedDescription:
        "Mantén visible la mascota compartida y usa el botón Test en Vapi. Esa página combina todos los asistentes conectados, así que cada llamada debe iniciarse desde el dashboard de su asistente.",
      openPet: "Abrir mi VapiGotchi →",
      openDashboard: "Abrir el dashboard de Vapi ↗",
      testLabel: "Prueba esto en la llamada",
      testPrompt:
        "¿Cómo te sientes? Si tienes hambre, elige algo delicioso de Latinoamérica y cómetelo.",
    },
    bonus: {
      eyebrow: "Extensión opcional",
      title: "Agrega salsa, duchas y siestas",
      description:
        "El workshop principal sigue usando solo dos tools. Abre este bonus cuando quieras agregar una tool de cuidado con tres acciones animadas.",
      composerLabel: "Prompt opcional para Composer",
      promptLabel: "Extensión opcional del system prompt",
      promptAddendum:
        "Cuando te pidan bailar salsa, darte una ducha o tomar una siesta, llama a care_for_vapigotchi con dance-salsa, shower o nap. Llámala en silencio y reacciona solo después de que termine correctamente.",
      careMeta: "POST · acciones opcionales",
    },
    tools: {
      feedDescription:
        "Alimenta a tu VapiGotchi cuando la persona lo pida. Usa la comida que solicite o sorpréndela.",
      foodDescription: "La comida que recibirá el VapiGotchi.",
      stateDescription:
        "Consulta la salud, el ánimo, el nombre y las comidas del VapiGotchi antes de responder preguntas sobre él.",
      careDescription:
        "Haz que el VapiGotchi baile salsa, se dé una ducha o tome una siesta cuando la persona lo pida.",
      actionDescription:
        "La acción de cuidado que realizará el VapiGotchi: dance-salsa, shower o nap.",
    },
  },
} as const satisfies Record<SetupLanguage, unknown>;
