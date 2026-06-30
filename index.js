// =========================================================
// Loki_devrbx Portfolio Bot
// Poste une création dans le salon dédié, réagis avec 🚀
// pour la publier sur le portfolio. Édite le message pour
// changer le prix / la description à tout moment.
// Réagis avec 🗑️ pour la retirer du portfolio.
// =========================================================

require('dotenv').config();
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

const {
  DISCORD_TOKEN,
  SHOWCASE_CHANNEL_ID,
  PRICING_CHANNEL_ID,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  PUBLISH_EMOJI = '🚀',
  REMOVE_EMOJI = '🗑️',
} = process.env;

if (!DISCORD_TOKEN || !SHOWCASE_CHANNEL_ID || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Variables d\'environnement manquantes. Vérifie ton fichier .env (voir .env.example).');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

// ---------------------------------------------------------
// Parsing du message Discord -> objet "création"
//
// Format attendu dans le message (un champ par ligne) :
//
//   Titre: Lobby System
//   Prix: 25€
//   Catégorie: Système
//   Statut: Disponible
//   Lien: https://www.roblox.com/games/xxxx
//   Description: Système de lobby complet avec animations
//   fluides et UI immersive.
//
// Seul "Titre" est obligatoire, tout le reste a une valeur
// par défaut. La Description peut être écrite sur plusieurs
// lignes : tout ce qui suit "Description:" jusqu'au champ
// suivant (ou la fin) est conservé.
// ---------------------------------------------------------
const FIELD_KEYS = {
  titre: 'title',
  title: 'title',
  prix: 'price',
  price: 'price',
  categorie: 'category',
  'catégorie': 'category',
  category: 'category',
  statut: 'status',
  status: 'status',
  lien: 'link',
  link: 'link',
  description: 'description',
  desc: 'description',
};

function normalizeKey(raw) {
  return raw
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, ''); // retire les accents
}

function parseMessageContent(content) {
  const result = {
    title: null,
    price: 'Sur devis',
    category: 'Autre',
    status: 'Disponible',
    link: null,
    description: '',
  };

  if (!content) return result;

  const lines = content.split('\n');
  let currentField = null;

  for (const rawLine of lines) {
    const match = rawLine.match(/^\s*([^:]{1,20}):\s*(.*)$/);
    if (match) {
      const key = normalizeKey(match[1]);
      if (FIELD_KEYS[key]) {
        currentField = FIELD_KEYS[key];
        result[currentField] = match[2].trim();
        continue;
      }
    }
    // Ligne de continuation : on l'ajoute au champ courant (utile pour Description)
    if (currentField && rawLine.trim().length > 0) {
      result[currentField] = `${result[currentField]}\n${rawLine.trim()}`.trim();
    }
  }

  return result;
}

function extractImages(message) {
  return [...message.attachments.values()]
    .filter((a) => a.contentType && a.contentType.startsWith('image/'))
    .map((a) => a.url);
}

// ---------------------------------------------------------
// Parsing du message Discord -> objet "formule de tarif"
//
// Format attendu dans le salon dédié aux tarifs :
//
//   Nom: Basic
//   Eyebrow: Most popular
//   Prix: $15
//   Detail: 4,000 Robux / frame
//   Mis en avant: oui
//   Lien: https://discord.gg/tonserveur
//   Features:
//   Free HUD on first order
//   Clean polished design
//   Core UI elements
//   1 revision
//   Delivery in 1-2 days
//
// Seul "Nom" est obligatoire. "Mis en avant: oui" met la carte
// en valeur (comme "MOST POPULAR"). Chaque ligne après
// "Features:" devient un point de la liste.
// ---------------------------------------------------------
const PRICING_FIELD_KEYS = {
  nom: 'name',
  name: 'name',
  eyebrow: 'eyebrow',
  prix: 'price',
  price: 'price',
  detail: 'detail',
  details: 'detail',
  lien: 'link',
  link: 'link',
  'mis en avant': 'highlighted',
  highlighted: 'highlighted',
  features: 'features',
  feature: 'features',
  avantages: 'features',
};

function parsePricingMessage(content) {
  const result = {
    name: null,
    eyebrow: '',
    price: '',
    detail: '',
    link: null,
    highlighted: false,
    features: [],
  };

  if (!content) return result;

  const lines = content.split('\n');
  let currentField = null;

  for (const rawLine of lines) {
    const match = rawLine.match(/^\s*([^:]{1,20}):\s*(.*)$/);
    if (match) {
      const key = normalizeKey(match[1]);
      if (PRICING_FIELD_KEYS[key]) {
        currentField = PRICING_FIELD_KEYS[key];
        const value = match[2].trim();
        if (currentField === 'features') {
          result.features = value ? [value] : [];
        } else if (currentField === 'highlighted') {
          result.highlighted = /^(oui|yes|true|1)$/i.test(value);
        } else {
          result[currentField] = value;
        }
        continue;
      }
    }
    if (currentField === 'features' && rawLine.trim().length > 0) {
      result.features.push(rawLine.trim().replace(/^[-—]\s*/, ''));
    } else if (
      currentField &&
      currentField !== 'features' &&
      currentField !== 'highlighted' &&
      rawLine.trim().length > 0
    ) {
      result[currentField] = `${result[currentField]} ${rawLine.trim()}`.trim();
    }
  }

  return result;
}

async function upsertCreation(message) {
  const parsed = parseMessageContent(message.content);

  if (!parsed.title) {
    await safeReact(message, '⚠️');
    await message.reply({
      content:
        '⚠️ Impossible de publier : le message doit contenir au minimum une ligne `Titre: ...`.',
      allowedMentions: { repliedUser: false },
    }).catch(() => {});
    return;
  }

  const images = extractImages(message);

  const row = {
    id: message.id,
    title: parsed.title,
    price: parsed.price || 'Sur devis',
    category: parsed.category || 'Autre',
    status: parsed.status || 'Disponible',
    description: parsed.description || '',
    link: parsed.link || null,
    images,
    published: true,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase.from('creations').upsert(row, { onConflict: 'id' });

  if (error) {
    console.error('Erreur Supabase (upsert):', error.message);
    await safeReact(message, '❌');
    return;
  }

  console.log(`✅ Publié/MAJ: "${row.title}" (${row.price})`);
  await safeReact(message, '✅');
}

async function removeCreation(message) {
  const { error } = await supabase.from('creations').delete().eq('id', message.id);
  if (error) {
    console.error('Erreur Supabase (delete):', error.message);
    return;
  }
  console.log(`🗑️ Retiré du portfolio: message ${message.id}`);
  await safeReact(message, '✅');
}

async function upsertPricing(message) {
  const parsed = parsePricingMessage(message.content);

  if (!parsed.name) {
    await safeReact(message, '⚠️');
    await message.reply({
      content:
        '⚠️ Impossible de publier : le message doit contenir au minimum une ligne `Nom: ...`.',
      allowedMentions: { repliedUser: false },
    }).catch(() => {});
    return;
  }

  const row = {
    id: message.id,
    name: parsed.name,
    eyebrow: parsed.eyebrow || '',
    price: parsed.price || '',
    detail: parsed.detail || '',
    link: parsed.link || null,
    highlighted: parsed.highlighted,
    features: parsed.features,
    published: true,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase.from('pricing_plans').upsert(row, { onConflict: 'id' });

  if (error) {
    console.error('Erreur Supabase (upsert pricing):', error.message);
    await safeReact(message, '❌');
    return;
  }

  console.log(`✅ Tarif publié/MAJ: "${row.name}" (${row.price})`);
  await safeReact(message, '✅');
}

async function removePricing(message) {
  const { error } = await supabase.from('pricing_plans').delete().eq('id', message.id);
  if (error) {
    console.error('Erreur Supabase (delete pricing):', error.message);
    return;
  }
  console.log(`🗑️ Tarif retiré: message ${message.id}`);
  await safeReact(message, '✅');
}

async function safeReact(message, emoji) {
  try {
    await message.react(emoji);
  } catch (e) {
    // ignore (ex: permissions manquantes)
  }
}

function isShowcaseChannel(channelId) {
  return channelId === SHOWCASE_CHANNEL_ID;
}

function isPricingChannel(channelId) {
  return !!PRICING_CHANNEL_ID && channelId === PRICING_CHANNEL_ID;
}

// ---------------------------------------------------------
// Événements
// ---------------------------------------------------------

client.once('clientReady', () => {
  console.log(`🤖 Connecté en tant que ${client.user.tag}`);
  console.log(`📡 Salon créations surveillé: ${SHOWCASE_CHANNEL_ID}`);
  console.log(`📡 Salon tarifs surveillé: ${PRICING_CHANNEL_ID || '(non configuré)'}`);
  console.log(`   Réagis avec ${PUBLISH_EMOJI} pour publier, ${REMOVE_EMOJI} pour retirer.`);
});

client.on('messageReactionAdd', async (reaction, user) => {
  try {
    if (user.bot) return;
    if (reaction.partial) await reaction.fetch();
    if (reaction.message.partial) await reaction.message.fetch();

    const { message } = reaction;
    const emoji = reaction.emoji.name;

    if (isShowcaseChannel(message.channelId)) {
      if (emoji === PUBLISH_EMOJI) {
        await upsertCreation(message);
      } else if (emoji === REMOVE_EMOJI) {
        await removeCreation(message);
      }
    } else if (isPricingChannel(message.channelId)) {
      if (emoji === PUBLISH_EMOJI) {
        await upsertPricing(message);
      } else if (emoji === REMOVE_EMOJI) {
        await removePricing(message);
      }
    }
  } catch (err) {
    console.error('Erreur messageReactionAdd:', err);
  }
});

// Édite ton message (prix, description, image...) -> auto-sync
// si la création est déjà publiée sur le portfolio.
client.on('messageUpdate', async (oldMessage, newMessage) => {
  try {
    if (newMessage.partial) await newMessage.fetch();

    if (isShowcaseChannel(newMessage.channelId)) {
      const { data, error } = await supabase
        .from('creations')
        .select('id')
        .eq('id', newMessage.id)
        .maybeSingle();

      if (error) {
        console.error('Erreur Supabase (check existence):', error.message);
        return;
      }
      if (!data) return; // pas encore publié -> on ne touche à rien

      await upsertCreation(newMessage);
    } else if (isPricingChannel(newMessage.channelId)) {
      const { data, error } = await supabase
        .from('pricing_plans')
        .select('id')
        .eq('id', newMessage.id)
        .maybeSingle();

      if (error) {
        console.error('Erreur Supabase (check existence pricing):', error.message);
        return;
      }
      if (!data) return;

      await upsertPricing(newMessage);
    }
  } catch (err) {
    console.error('Erreur messageUpdate:', err);
  }
});

// Supprime le message Discord -> supprime aussi du portfolio
client.on('messageDelete', async (message) => {
  try {
    if (isShowcaseChannel(message.channelId)) {
      await supabase.from('creations').delete().eq('id', message.id);
      console.log(`🗑️ Message supprimé sur Discord -> retiré du portfolio (${message.id})`);
    } else if (isPricingChannel(message.channelId)) {
      await supabase.from('pricing_plans').delete().eq('id', message.id);
      console.log(`🗑️ Message supprimé sur Discord -> tarif retiré (${message.id})`);
    }
  } catch (err) {
    console.error('Erreur messageDelete:', err);
  }
});

client.login(DISCORD_TOKEN);
