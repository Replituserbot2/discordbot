require('dotenv').config();
const {
  Client, GatewayIntentBits, Partials, EmbedBuilder,
  PermissionFlagsBits, SlashCommandBuilder, REST, Routes, Events
} = require('discord.js');
const Groq = require('groq-sdk');

// ─── Clients ────────────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ─── In-memory stores ────────────────────────────────────────────────────────
const welcomeChannels   = new Map(); // guildId  → channelId
const conversationHistory = new Map(); // channelId → messages[]

// ─── Slash command definitions ───────────────────────────────────────────────
const commands = [
  // Moderation
  new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kick a member from the server')
    .addUserOption(o => o.setName('user').setDescription('Member to kick').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason for kick'))
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),

  new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a member from the server')
    .addUserOption(o => o.setName('user').setDescription('Member to ban').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason for ban'))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

  new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Unban a user by their ID')
    .addStringOption(o => o.setName('userid').setDescription('User ID to unban').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

  new SlashCommandBuilder()
    .setName('mute')
    .setDescription('Timeout (mute) a member')
    .addUserOption(o => o.setName('user').setDescription('Member to mute').setRequired(true))
    .addIntegerOption(o => o.setName('minutes').setDescription('Duration in minutes').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  new SlashCommandBuilder()
    .setName('unmute')
    .setDescription('Remove timeout from a member')
    .addUserOption(o => o.setName('user').setDescription('Member to unmute').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Warn a member (also DMs them)')
    .addUserOption(o => o.setName('user').setDescription('Member to warn').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason for warn').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  new SlashCommandBuilder()
    .setName('purge')
    .setDescription('Delete multiple messages at once')
    .addIntegerOption(o => o.setName('amount').setDescription('Number of messages (1-100)').setRequired(true).setMinValue(1).setMaxValue(100))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  // Welcome
  new SlashCommandBuilder()
    .setName('setwelcome')
    .setDescription('Set the channel for welcome messages')
    .addChannelOption(o => o.setName('channel').setDescription('Welcome channel').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('testwelcome')
    .setDescription('Preview the welcome message')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  // AI
  new SlashCommandBuilder()
    .setName('ask')
    .setDescription('Ask the AI a one-off question')
    .addStringOption(o => o.setName('question').setDescription('Your question').setRequired(true)),

  new SlashCommandBuilder()
    .setName('clearchat')
    .setDescription('Clear the AI conversation history for this channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
];

// ─── Register slash commands ─────────────────────────────────────────────────
async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    console.log('📡 Registering slash commands...');
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), {
      body: commands.map(c => c.toJSON()),
    });
    console.log('✅ Slash commands registered!');
  } catch (err) {
    console.error('❌ Failed to register commands:', err);
  }
}

// ─── Bot ready ───────────────────────────────────────────────────────────────
client.once(Events.ClientReady, async () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
  client.user.setActivity('your server 👀', { type: 3 }); // WATCHING
  await registerCommands();
});

// ─── Welcome new members ─────────────────────────────────────────────────────
client.on(Events.GuildMemberAdd, async (member) => {
  const channelId = welcomeChannels.get(member.guild.id);
  if (!channelId) return;

  const channel = member.guild.channels.cache.get(channelId);
  if (!channel) return;

  const embed = buildWelcomeEmbed(member);
  await channel.send({ embeds: [embed] });
});

function buildWelcomeEmbed(member) {
  return new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(`👋 Welcome to ${member.guild.name}!`)
    .setDescription(
      `Hey ${member}, we're glad you're here!\n` +
      `You are member **#${member.guild.memberCount}**. Enjoy your stay! 🎉`
    )
    .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }))
    .setFooter({ text: member.guild.name, iconURL: member.guild.iconURL() })
    .setTimestamp();
}

// ─── AI auto-responder (mention the bot to chat) ─────────────────────────────
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  if (!message.mentions.has(client.user)) return;

  const userMessage = message.content.replace(/<@!?\d+>/g, '').trim();
  if (!userMessage) {
    return message.reply('Hey! Mention me with a question and I\'ll answer. Try `@BotName what is the meaning of life?`');
  }

  await message.channel.sendTyping();

  // Maintain per-channel conversation history (last 20 messages)
  const cid = message.channel.id;
  if (!conversationHistory.has(cid)) conversationHistory.set(cid, []);
  const history = conversationHistory.get(cid);

  history.push({ role: 'user', content: `${message.author.username}: ${userMessage}` });
  if (history.length > 20) history.splice(0, 2); // drop oldest pair

  try {
    const response = await groq.chat.completions.create({
      model: 'llama3-70b-8192',
      max_tokens: 600,
      messages: [
        {
          role: 'system',
          content:
            'You are a friendly, helpful Discord bot assistant named Clyde. ' +
            'Keep responses concise (under 400 words) and suitable for Discord chat. ' +
            'Use Discord markdown (bold, italic, code blocks) when helpful. ' +
            'Be engaging and slightly casual.',
        },
        ...history,
      ],
    });

    const reply = response.choices[0].message.content;
    history.push({ role: 'assistant', content: reply });

    // Split messages longer than 2000 chars
    if (reply.length > 2000) {
      const chunks = reply.match(/[\s\S]{1,2000}/g);
      for (const chunk of chunks) await message.reply(chunk);
    } else {
      await message.reply(reply);
    }
  } catch (err) {
    console.error('AI error:', err);
    await message.reply('❌ The AI ran into an error. Please try again!');
  }
});

// ─── Slash command handler ───────────────────────────────────────────────────
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName } = interaction;

  // ── /kick ──────────────────────────────────────────────────────────────────
  if (commandName === 'kick') {
    const target = interaction.options.getMember('user');
    const reason = interaction.options.getString('reason') ?? 'No reason provided';

    if (!target) return interaction.reply({ content: '❌ User not found.', ephemeral: true });
    if (!target.kickable) return interaction.reply({ content: '❌ I don\'t have permission to kick this user.', ephemeral: true });

    await target.kick(reason);
    await interaction.reply({ embeds: [
      new EmbedBuilder().setColor(0xFF6B35).setTitle('👢 Member Kicked')
        .addFields(
          { name: 'User', value: `${target.user.tag} (${target.id})`, inline: true },
          { name: 'Moderator', value: interaction.user.tag, inline: true },
          { name: 'Reason', value: reason }
        ).setTimestamp()
    ]});
  }

  // ── /ban ───────────────────────────────────────────────────────────────────
  else if (commandName === 'ban') {
    const target = interaction.options.getMember('user');
    const reason = interaction.options.getString('reason') ?? 'No reason provided';

    if (!target) return interaction.reply({ content: '❌ User not found.', ephemeral: true });
    if (!target.bannable) return interaction.reply({ content: '❌ I don\'t have permission to ban this user.', ephemeral: true });

    await target.ban({ reason, deleteMessageSeconds: 86400 });
    await interaction.reply({ embeds: [
      new EmbedBuilder().setColor(0xFF0000).setTitle('🔨 Member Banned')
        .addFields(
          { name: 'User', value: `${target.user.tag} (${target.id})`, inline: true },
          { name: 'Moderator', value: interaction.user.tag, inline: true },
          { name: 'Reason', value: reason }
        ).setTimestamp()
    ]});
  }

  // ── /unban ─────────────────────────────────────────────────────────────────
  else if (commandName === 'unban') {
    const userId = interaction.options.getString('userid');
    try {
      await interaction.guild.members.unban(userId);
      await interaction.reply({ embeds: [
        new EmbedBuilder().setColor(0x00C853).setTitle('✅ User Unbanned')
          .addFields({ name: 'User ID', value: userId })
          .setTimestamp()
      ]});
    } catch {
      await interaction.reply({ content: '❌ Could not unban — invalid ID or user is not banned.', ephemeral: true });
    }
  }

  // ── /mute ──────────────────────────────────────────────────────────────────
  else if (commandName === 'mute') {
    const target = interaction.options.getMember('user');
    const minutes = interaction.options.getInteger('minutes');
    const reason  = interaction.options.getString('reason') ?? 'No reason provided';

    if (!target) return interaction.reply({ content: '❌ User not found.', ephemeral: true });
    if (!target.moderatable) return interaction.reply({ content: '❌ I can\'t timeout this user.', ephemeral: true });

    await target.timeout(minutes * 60 * 1000, reason);
    await interaction.reply({ embeds: [
      new EmbedBuilder().setColor(0xFFA500).setTitle('🔇 Member Muted (Timeout)')
        .addFields(
          { name: 'User', value: `${target.user.tag}`, inline: true },
          { name: 'Duration', value: `${minutes} minute(s)`, inline: true },
          { name: 'Reason', value: reason }
        ).setTimestamp()
    ]});
  }

  // ── /unmute ────────────────────────────────────────────────────────────────
  else if (commandName === 'unmute') {
    const target = interaction.options.getMember('user');
    if (!target) return interaction.reply({ content: '❌ User not found.', ephemeral: true });

    await target.timeout(null);
    await interaction.reply({ embeds: [
      new EmbedBuilder().setColor(0x00E676).setTitle('🔊 Member Unmuted')
        .addFields({ name: 'User', value: target.user.tag })
        .setTimestamp()
    ]});
  }

  // ── /warn ──────────────────────────────────────────────────────────────────
  else if (commandName === 'warn') {
    const target = interaction.options.getMember('user');
    const reason = interaction.options.getString('reason');
    if (!target) return interaction.reply({ content: '❌ User not found.', ephemeral: true });

    // Try to DM the user
    try {
      await target.send(
        `⚠️ **You have been warned** in **${interaction.guild.name}**.\n` +
        `**Reason:** ${reason}\n\n` +
        `Please follow the server rules to avoid further action.`
      );
    } catch { /* User has DMs disabled */ }

    await interaction.reply({ embeds: [
      new EmbedBuilder().setColor(0xFFD700).setTitle('⚠️ Member Warned')
        .addFields(
          { name: 'User', value: `${target.user.tag}`, inline: true },
          { name: 'Moderator', value: interaction.user.tag, inline: true },
          { name: 'Reason', value: reason }
        ).setFooter({ text: 'User was DM\'d if their DMs are open.' })
        .setTimestamp()
    ]});
  }

  // ── /purge ─────────────────────────────────────────────────────────────────
  else if (commandName === 'purge') {
    const amount = interaction.options.getInteger('amount');
    try {
      const deleted = await interaction.channel.bulkDelete(amount, true);
      await interaction.reply({ content: `🗑️ Deleted **${deleted.size}** message(s).`, ephemeral: true });
    } catch (err) {
      await interaction.reply({ content: '❌ Failed to delete messages. Messages older than 14 days cannot be bulk deleted.', ephemeral: true });
    }
  }

  // ── /setwelcome ────────────────────────────────────────────────────────────
  else if (commandName === 'setwelcome') {
    const channel = interaction.options.getChannel('channel');
    welcomeChannels.set(interaction.guild.id, channel.id);
    await interaction.reply({ content: `✅ Welcome messages will now be sent in ${channel}!`, ephemeral: true });
  }

  // ── /testwelcome ───────────────────────────────────────────────────────────
  else if (commandName === 'testwelcome') {
    const channelId = welcomeChannels.get(interaction.guild.id);
    if (!channelId) return interaction.reply({ content: '❌ No welcome channel set. Use `/setwelcome` first.', ephemeral: true });

    const channel = interaction.guild.channels.cache.get(channelId);
    if (!channel) return interaction.reply({ content: '❌ Saved welcome channel no longer exists.', ephemeral: true });

    const embed = buildWelcomeEmbed(interaction.member);
    await channel.send({ embeds: [embed] });
    await interaction.reply({ content: `✅ Test welcome sent to ${channel}!`, ephemeral: true });
  }

  // ── /ask ───────────────────────────────────────────────────────────────────
  else if (commandName === 'ask') {
    const question = interaction.options.getString('question');
    await interaction.deferReply();

    try {
      const response = await groq.chat.completions.create({
        model: 'llama3-70b-8192',
        max_tokens: 600,
        messages: [
          { role: 'system', content: 'You are a helpful Discord bot assistant. Keep answers concise and use Discord markdown formatting when helpful.' },
          { role: 'user', content: question },
        ],
      });

      const answer = response.choices[0].message.content;
      await interaction.editReply(answer.length > 2000 ? answer.slice(0, 1997) + '...' : answer);
    } catch (err) {
      console.error('AI /ask error:', err);
      await interaction.editReply('❌ AI error — please try again.');
    }
  }

  // ── /clearchat ─────────────────────────────────────────────────────────────
  else if (commandName === 'clearchat') {
    conversationHistory.delete(interaction.channel.id);
    await interaction.reply({ content: '🧹 AI conversation history for this channel has been cleared!', ephemeral: true });
  }
});

// ─── Error handling ──────────────────────────────────────────────────────────
client.on('error', console.error);
process.on('unhandledRejection', (err) => console.error('Unhandled rejection:', err));

// ─── Login ───────────────────────────────────────────────────────────────────
client.login(process.env.DISCORD_TOKEN);
