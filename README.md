# NOVA - JnA Events AI-agent

Een zichtbare, pratende AI-agent voor JnA Events, gekoppeld aan Claude.
Werkt op https://jna-events.nl/agents met werkende microfoon en gesproken antwoorden.

---

## Belangrijk: wat "live" wel en niet betekent

De antwoorden van NOVA zijn altijd live, want ze komen rechtstreeks van Claude
via je eigen backend. Elke vraag wordt op het moment zelf beantwoord.

Wat NIET kan: de AI kan zichzelf niet rechtstreeks in je draaiende website
aanpassen. De code op jna-events.nl is een kopie die op jouw server staat.
Verbeteringen werken zo: je past de code aan (eventueel samen met Claude in een
chat), je doet een git push, en Vercel zet de nieuwe versie automatisch live.
Jij bent de schakel die de update activeert. Dat is met opzet zo - het is jouw
website en jouw controle.

---

## Wat zit erin

- src/App.jsx     de agent met hologram-orb, chat, spraak in en spraak uit
- server.js       backend-proxy voor je eigen server (houdt API-sleutel geheim)
- api/chat.js     dezelfde proxy als serverless function voor Vercel
- vite.config.js  ingesteld op base "/agents/" voor jna-events.nl/agents

---

## Waarom een backend?

Je Anthropic API-sleutel mag NOOIT in de browser staan - iedere bezoeker kan
hem dan uitlezen en op jouw rekening de API gebruiken. De browser praat daarom
met jouw eigen kleine server, en die server praat met Claude. De sleutel staat
alleen in de omgevingsvariabelen, nooit in de code.

---

## Stap 1 - Lokaal testen (microfoon werkt hier al)

1. Installeer Node.js 18 of hoger (https://nodejs.org).
2. Open een terminal in deze map.
3. npm install
4. Maak een API-sleutel op https://console.anthropic.com -> API Keys -> Create Key
5. Kopieer .env.example naar .env en plak je sleutel erin.
6. npm run dev
7. Open http://localhost:5173/agents in Chrome of Edge.
   De eerste keer vraagt de browser om microfoon-toestemming -> sta toe.

---

## Stap 2 - Live zetten op jna-events.nl/agents (Vercel + git push)

Dit is de gekozen workflow: na de eerste setup is elke update een git push.

Eerste keer instellen:
1. Maak een GitHub-account en zet deze map in een nieuwe repository:
     git init
     git add .
     git commit -m "NOVA agent eerste versie"
     git branch -M main
     git remote add origin https://github.com/JOUW-NAAM/jna-nova-agent.git
     git push -u origin main
2. Ga naar https://vercel.com, log in met GitHub en kies "Import Project".
3. Selecteer je repo. Vercel herkent Vite automatisch.
4. Bij Environment Variables voeg je toe:
     Naam:  ANTHROPIC_API_KEY
     Waarde: je echte sleutel
5. Klik Deploy. Je krijgt een URL zoals jouwproject.vercel.app/agents
6. Koppel je domein: Vercel -> Settings -> Domains -> voeg jna-events.nl toe
   en volg de DNS-stappen. Daarna werkt https://jna-events.nl/agents

Vanaf nu - elke verbetering live zetten:
     git add .
     git commit -m "beschrijf je wijziging"
     git push
Vercel bouwt en publiceert automatisch binnen een minuut. Dat is je "live update".

---

## De microfoon

De microfoon werkt alleen als:
- de site via https draait (of localhost tijdens testen), EN
- de bezoeker de browser toestemming geeft, EN
- de browser Chrome of Edge is (beste ondersteuning).
Op jna-events.nl met https is daar automatisch aan voldaan.

---

## De stem (nieuw verbeterd)

- NOVA leest geen opmaak meer voor: sterretjes, hekjes, opsommingen en links
  worden weggefilterd voordat de tekst wordt uitgesproken.
- De system prompt dwingt nu vloeiende spreektaal af, geen lijstjes of markdown.
- De toon staat op zakelijk en strak (rustig tempo, neutrale toonhoogte).
- Er is een stem-aan/uit-knop rechtsboven.
- De app kiest automatisch de beste Nederlandse stem die je systeem heeft.
  Wil je een echt premium stem (zoals een mens), dan kun je later een
  betaalde stemdienst koppelen (bijvoorbeeld ElevenLabs of Azure Neural).
  Vraag Claude om die koppeling als je dat wilt.

---

## Aanpassen

- Persoonlijkheid van NOVA: pas SYSTEM_PROMPT aan in server.js en api/chat.js.
- Kleuren en look: bovenaan src/App.jsx (PURPLE, CYAN, DEEP).
- Ander model: verander claude-sonnet-4-6 in beide proxy-bestanden.
- Andere URL dan /agents: pas base aan in vite.config.js.

---

## Nieuw: actie-sterren rond NOVA

Als NOVA antwoordt, leidt ze drie tot vier logische vervolgacties af. Die
verschijnen als gloeiende sterren rond de JnA Events-cirkel. Klik op een ster
om die actie als vervolgvraag te sturen - handig en snel.

Als er geen acties uitgeklapt zijn, zweven er rustige sterren rond die
vervagen en op willekeurige plekken terugkomen, als sterren achter wolken.
Zo voelt de agent levend, ook als hij wacht.

De acties komen echt uit het antwoord: NOVA stuurt ze mee vanuit de backend.
Wil je het aantal of de stijl aanpassen, dan zit de logica in src/App.jsx
(zoek op act-star en idle-star) en de instructie in server.js / api/chat.js
(zoek op ACTIES).

---

## Automatisch naar GitHub pushen

Je hoeft nooit handmatig git-commando's te typen. Na de eerste koppeling
(zie stap 2) gebruik je gewoon:

    npm run push

Dit voegt alles toe, commit het en pusht naar GitHub. Vercel zet de nieuwe
versie daarna binnen ongeveer een minuut vanzelf live. Wil je een eigen
omschrijving meegeven:

    npm run push "stem natuurlijker gemaakt"

Let op: ik (de AI) kan niet zelf naar jouw GitHub pushen - ik heb geen toegang
tot je account, en dat hoort ook zo. Dit script maakt het voor jou wel één
commando in plaats van drie. De koppeling met je repo stel je eenmalig in
volgens stap 2 van deze README.
