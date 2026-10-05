import {
  ActionRowBuilder,
  ActivityType,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
  type SendableChannels,
} from "discord.js";
import { randomInt } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import {
  db,
  giveawayEntriesTable,
  giveawaysTable,
  staffApplicationDenialsTable,
  ticketRejectionsTable,
  ticketsTable,
} from "@workspace/db";
import { logger } from "./lib/logger";

const APPLICATION_CHANNEL_ID = "1553444704354574446";
const REVIEW_CHANNEL_ID = "1554491171982549032";
const TRAINEE_ROLE_ID = "1550591722445209670";
const SECOND_STAFF_ROLE_ID = "1550592757767348364";

const APPLY_BUTTON_ID = "staff_application_apply";
const CONTINUE_BUTTON_ID = "staff_application_continue";
const FIRST_STEP_MODAL_ID = "staff_application_first_step";
const SECOND_STEP_MODAL_ID = "staff_application_second_step";
const DENY_REASON_MODAL_PREFIX = "staff_application_deny_reason";
const DENIAL_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const GIVEAWAY_COMMAND_NAME = "giveaway";
const GIVEAWAY_MODAL_ID = "giveaway_create_modal";
const GIVEAWAY_ENTER_PREFIX = "giveaway_enter:";
const TICKET_PANEL_CHANNEL_ID = "1550860534042075257";
const TICKET_CATEGORY_ID = "1550855474629316668";
const PARTNERSHIP_AD_CHANNEL_ID = "1550857661631828018";
const TICKET_REVIEW_ROLE_ID = "1550592757767348364";
const TICKET_OPEN_PREFIX = "ticket_open:";
const TICKET_MODAL_PREFIX = "ticket_form:";
const TICKET_ACCEPT_PREFIX = "ticket_accept:";
const TICKET_REJECT_PREFIX = "ticket_reject:";
const TICKET_CLOSE_PREFIX = "ticket_close:";
const TICKET_REJECTION_THRESHOLD = 2;
const MIN_GIVEAWAY_DURATION_MS = 10 * 1000;
const MAX_GIVEAWAY_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_TIMEOUT_MS = 2_147_000_000;

const applicationPanelEmbed = new EmbedBuilder()
  .setColor(0x3498db)
  .setTitle("📋 Trainee Staff Application")
  .setDescription(
    [
      "Want to join our staff team? Apply for the **Trainee** position and show us what you can do!",
      "",
      "⭐ Work hard, stay active, and help the community.",
      "📈 **Do good work, and you may be promoted to a higher staff rank!**",
      "",
      "Good luck with your application! 🍀",
    ].join("\n"),
  )
  .setFooter({ text: "Use the button below to start your application." });

const ticketPanelEmbed = new EmbedBuilder()
  .setColor(0x5865f2)
  .setTitle("🎫 Ticket Support")
  .setDescription(
    [
      "Need help? Choose the ticket type below and our staff will get back to you!",
      "",
      "🤝 **Partnership**",
      "Want to partner with us? Open a Partnership ticket.",
      "",
      "🚨 **Report**",
      "Need to report a member or something that happened? Open a Report ticket.",
      "",
      "🛠️ **Support**",
      "Got a question or need help with something? Open a Support ticket.",
      "",
      "Please choose the option that matches your issue.",
    ].join("\n"),
  )
  .setFooter({ text: "Select a button below to open a private ticket." });

const partnershipAdvertisement = [
  "🎮 **MCPE Community**",
  "> Our server is a community built for **Minecraft Pocket Edition players** from around the world.",
  "",
  "> 🌎 Our goal is to create a **friendly, active, and enjoyable environment** where Minecraft players can come together and share their passion for the game.",
  "",
  "> 🏆 **MCPE Community** is more than just a place to chat. We aim to provide **exciting activities, and community events.**",
  "",
  "-# 🌟 Whether you're a **casual player, competitive player, content creator, builder, or simply a Minecraft enthusiast,** everyone is welcome.",
  "https://discord.gg/CXcQMcVrv4",
].join("\n");

type TicketKind = "partnership" | "support" | "report";

type FirstStepAnswers = {
  ign: string;
  age: string;
  motivation: string;
};

type PendingApplication = FirstStepAnswers & {
  userId: string;
  startedAt: number;
};

const pendingApplications = new Map<string, PendingApplication>();
const giveawayTimers = new Map<string, NodeJS.Timeout>();
const finishingGiveaways = new Set<string>();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const giveawayCommand = new SlashCommandBuilder()
  .setName(GIVEAWAY_COMMAND_NAME)
  .setDescription("Create a giveaway")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .toJSON();

function applicationButtonRow(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(APPLY_BUTTON_ID)
      .setLabel("Apply")
      .setEmoji("🔨")
      .setStyle(ButtonStyle.Primary),
  );
}

function continueButtonRow(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(CONTINUE_BUTTON_ID)
      .setLabel("Complete")
      .setStyle(ButtonStyle.Primary),
  );
}

function giveawayModal(): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(GIVEAWAY_MODAL_ID)
    .setTitle("Create Giveaway")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("prize")
          .setLabel("Prize")
          .setPlaceholder("What can people win?")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(200),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("duration")
          .setLabel("Duration")
          .setPlaceholder("Use 30s, 10m, 2h, or 1d")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(20),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("winners")
          .setLabel("How many winners?")
          .setPlaceholder("Example: 1")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(3),
      ),
    );
}

function ticketPanelButtons(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${TICKET_OPEN_PREFIX}partnership`)
      .setLabel("Partnership")
      .setEmoji("🤝")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`${TICKET_OPEN_PREFIX}support`)
      .setLabel("Support")
      .setEmoji("🛠️")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${TICKET_OPEN_PREFIX}report`)
      .setLabel("Report")
      .setEmoji("🚨")
      .setStyle(ButtonStyle.Danger),
  );
}

function ticketCloseButtonRow(
  channelId: string,
  disabled = false,
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${TICKET_CLOSE_PREFIX}${channelId}`)
      .setLabel("Close Ticket")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),
  );
}

function ticketReviewButtonRow(
  channelId: string,
  disabled = false,
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${TICKET_ACCEPT_PREFIX}${channelId}`)
      .setLabel("Accept")
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`${TICKET_REJECT_PREFIX}${channelId}`)
      .setLabel("Reject")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled),
  );
}

function ticketModal(type: TicketKind): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(`${TICKET_MODAL_PREFIX}${type}`)
    .setTitle(`${type[0].toUpperCase()}${type.slice(1)} Ticket`);

  if (type === "partnership") {
    return modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("member_count")
          .setLabel("How many members your server has?")
          .setPlaceholder("Enter the current member count")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(12),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("server_topic")
          .setLabel("What is your server related to?")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(1000),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("server_invite")
          .setLabel("Give the invite link of the server.")
          .setPlaceholder("https://discord.gg/...")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(500),
      ),
    );
  }

  if (type === "support") {
    return modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("question")
          .setLabel("What is your question?")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(3000),
      ),
    );
  }

  return modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("reported_username")
        .setLabel("Discord username of the person to report")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(100),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("reported_ign")
        .setLabel("In-game name")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(100),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("incident")
        .setLabel("What did he/she do?")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(2000),
    ),
  );
}

function giveawayButtonRow(
  giveawayId: string,
  disabled = false,
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${GIVEAWAY_ENTER_PREFIX}${giveawayId}`)
      .setLabel("Enter Giveaway")
      .setEmoji("🎉")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled),
  );
}

function parseGiveawayDuration(input: string): number | null {
  const match = input.trim().match(/^(\d+(?:\.\d+)?)\s*(s|m|h|d|w)$/i);
  if (!match) {
    return null;
  }

  const amount = Number.parseFloat(match[1]);
  const unit = match[2].toLowerCase();
  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
  };
  const duration = amount * multipliers[unit];

  if (
    !Number.isFinite(duration) ||
    duration < MIN_GIVEAWAY_DURATION_MS ||
    duration > MAX_GIVEAWAY_DURATION_MS
  ) {
    return null;
  }
  return duration;
}

function giveawayEmbed(
  prize: string,
  winnerCount: number,
  endsAt: Date,
  winnerIds?: string[],
): EmbedBuilder {
  const ended = winnerIds !== undefined;
  const embed = new EmbedBuilder()
    .setColor(ended ? 0x2ecc71 : 0x5865f2)
    .setTitle(`🎉 Giveaway — ${truncate(prize, 220)}`)
    .addFields({
      name: "Winners",
      value: String(winnerCount),
      inline: true,
    })
    .setTimestamp(endsAt);

  if (!ended) {
    embed.setDescription(
      `Click **Enter Giveaway** to enter!\n\nEnds <t:${Math.floor(endsAt.getTime() / 1000)}:R> (<t:${Math.floor(endsAt.getTime() / 1000)}:F>)`,
    );
  } else {
    const winnerText =
      winnerIds.length > 0
        ? winnerIds.map((userId) => `<@${userId}>`).join(", ")
        : "No one entered this giveaway.";
    embed
      .setDescription(`This giveaway has ended.\n\n**Winner(s):** ${winnerText}`)
      .setFooter({ text: "Giveaway ended" });
  }

  return embed;
}

function getGiveawayChannel(
  interaction: { channelId: string | null },
): Promise<SendableChannels> {
  if (!interaction.channelId) {
    throw new Error("Giveaways must be created in a text channel.");
  }
  return getTextChannel(interaction.channelId);
}

async function handleGiveawayCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (
    !interaction.guild ||
    !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
  ) {
    await interaction.reply({
      content: "Only staff members with Manage Server can create giveaways.",
      ephemeral: true,
    });
    return;
  }

  await interaction.showModal(giveawayModal());
}

async function handleGiveawaySubmit(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  const prize = interaction.fields.getTextInputValue("prize").trim();
  const durationInput = interaction.fields
    .getTextInputValue("duration")
    .trim();
  const winnersInput = interaction.fields.getTextInputValue("winners").trim();
  const durationMs = parseGiveawayDuration(durationInput);
  const winnerCount = Number.parseInt(winnersInput, 10);

  if (!durationMs) {
    await interaction.reply({
      content:
        "Invalid duration. Use a value from 10 seconds to 30 days, such as `30s`, `10m`, `2h`, or `1d`.",
      ephemeral: true,
    });
    return;
  }

  if (!Number.isInteger(winnerCount) || winnerCount < 1 || winnerCount > 100) {
    await interaction.reply({
      content: "Winners must be a whole number between 1 and 100.",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const endsAt = new Date(Date.now() + durationMs);
  let giveawayMessage;
  try {
    const channel = await getGiveawayChannel(interaction);
    giveawayMessage = await channel.send({
      embeds: [giveawayEmbed(prize, winnerCount, endsAt)],
      allowedMentions: { parse: [] },
    });

    await db.insert(giveawaysTable).values({
      id: giveawayMessage.id,
      channelId: channel.id,
      messageId: giveawayMessage.id,
      prize,
      winners: winnerCount,
      endsAt,
      createdBy: interaction.user.id,
    });

    await giveawayMessage.edit({
      components: [giveawayButtonRow(giveawayMessage.id)],
    });
    scheduleGiveawayEnd(giveawayMessage.id, endsAt);
    await interaction.editReply(
      `Giveaway created in <#${channel.id}> and ending <t:${Math.floor(endsAt.getTime() / 1000)}:R>.`,
    );
  } catch (error) {
    logger.error({ err: error }, "Could not create giveaway");
    if (giveawayMessage) {
      await giveawayMessage.delete().catch(() => undefined);
    }
    await interaction.editReply(
      "I could not create the giveaway. Please check that I can send messages and embeds in this channel.",
    );
  }
}

function scheduleGiveawayEnd(giveawayId: string, endsAt: Date): void {
  const currentTimer = giveawayTimers.get(giveawayId);
  if (currentTimer) {
    clearTimeout(currentTimer);
  }

  const remaining = Math.max(endsAt.getTime() - Date.now(), 0);
  const delay = Math.min(remaining, MAX_TIMEOUT_MS);
  const timer = setTimeout(() => {
    giveawayTimers.delete(giveawayId);
    if (Date.now() < endsAt.getTime()) {
      scheduleGiveawayEnd(giveawayId, endsAt);
      return;
    }
    void finishGiveaway(giveawayId);
  }, delay);
  giveawayTimers.set(giveawayId, timer);
}

async function finishGiveaway(giveawayId: string): Promise<void> {
  if (finishingGiveaways.has(giveawayId)) {
    return;
  }
  finishingGiveaways.add(giveawayId);

  try {
    const giveawayRows = await db
      .select()
      .from(giveawaysTable)
      .where(eq(giveawaysTable.id, giveawayId))
      .limit(1);
    const giveaway = giveawayRows[0];
    if (!giveaway || giveaway.endedAt) {
      return;
    }

    const entries = await db
      .select({ userId: giveawayEntriesTable.userId })
      .from(giveawayEntriesTable)
      .where(eq(giveawayEntriesTable.giveawayId, giveawayId));
    const entrantIds = entries.map((entry) => entry.userId);

    for (let index = entrantIds.length - 1; index > 0; index -= 1) {
      const randomIndex = randomInt(index + 1);
      [entrantIds[index], entrantIds[randomIndex]] = [
        entrantIds[randomIndex],
        entrantIds[index],
      ];
    }

    const winnerIds = entrantIds.slice(0, giveaway.winners);
    await db
      .update(giveawaysTable)
      .set({ endedAt: new Date() })
      .where(eq(giveawaysTable.id, giveawayId));

    try {
      const channel = await getTextChannel(giveaway.channelId);
      const message = await channel.messages.fetch(giveaway.messageId);
      await message.edit({
        embeds: [
          giveawayEmbed(
            giveaway.prize,
            giveaway.winners,
            giveaway.endsAt,
            winnerIds,
          ),
        ],
        components: [giveawayButtonRow(giveawayId, true)],
      });

      const announcement =
        winnerIds.length > 0
          ? `🎉 Giveaway ended! Congratulations ${winnerIds
              .map((userId) => `<@${userId}>`)
              .join(", ")} — you won **${giveaway.prize}**!`
          : `🎉 Giveaway ended, but nobody entered for **${giveaway.prize}**.`;
      await channel.send({
        content: announcement,
        allowedMentions:
          winnerIds.length > 0 ? { users: winnerIds } : { parse: [] },
      });
    } catch (error) {
      logger.error(
        { err: error, giveawayId },
        "Giveaway ended but Discord announcement failed",
      );
    }

    logger.info(
      { giveawayId, winnerIds },
      "Giveaway finished",
    );
  } catch (error) {
    logger.error({ err: error, giveawayId }, "Could not finish giveaway");
  } finally {
    giveawayTimers.delete(giveawayId);
    finishingGiveaways.delete(giveawayId);
  }
}

async function restoreActiveGiveaways(): Promise<void> {
  const activeGiveaways = await db
    .select({
      id: giveawaysTable.id,
      endsAt: giveawaysTable.endsAt,
    })
    .from(giveawaysTable)
    .where(isNull(giveawaysTable.endedAt));

  for (const giveaway of activeGiveaways) {
    scheduleGiveawayEnd(giveaway.id, giveaway.endsAt);
  }

  if (activeGiveaways.length > 0) {
    logger.info(
      { count: activeGiveaways.length },
      "Restored active giveaways",
    );
  }
}

async function registerGiveawayCommands(): Promise<void> {
  for (const guild of client.guilds.cache.values()) {
    const commands = await guild.commands.fetch();
    const existingCommand = commands.find(
      (command) => command.name === GIVEAWAY_COMMAND_NAME,
    );

    if (existingCommand) {
      continue;
    } else {
      await guild.commands.create(giveawayCommand);
    }
  }
}

async function handleGiveawayEntry(
  interaction: ButtonInteraction,
  giveawayId: string,
): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  try {
    const giveawayRows = await db
      .select()
      .from(giveawaysTable)
      .where(eq(giveawaysTable.id, giveawayId))
      .limit(1);
    const giveaway = giveawayRows[0];

    if (
      !giveaway ||
      giveaway.endedAt ||
      giveaway.endsAt.getTime() <= Date.now()
    ) {
      if (giveaway && !giveaway.endedAt) {
        void finishGiveaway(giveawayId);
      }
      await interaction.editReply("This giveaway has already ended.");
      return;
    }

    const inserted = await db
      .insert(giveawayEntriesTable)
      .values({ giveawayId, userId: interaction.user.id })
      .onConflictDoNothing()
      .returning({ userId: giveawayEntriesTable.userId });

    await interaction.editReply(
      inserted.length > 0
        ? "You are entered in the giveaway. Good luck!"
        : "You are already entered in this giveaway.",
    );
  } catch (error) {
    logger.error({ err: error, giveawayId }, "Could not enter giveaway");
    await interaction.editReply(
      "I could not add you to the giveaway. Please try again.",
    );
  }
}

function firstStepModal(): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(FIRST_STEP_MODAL_ID)
    .setTitle("Trainee Staff Application")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("ign")
          .setLabel("What is your IGN?")
          .setPlaceholder("Your in-game name")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(100),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("age")
          .setLabel("What is your age?")
          .setPlaceholder("Your age")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(3),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("motivation")
          .setLabel("Why apply for a staff position?")
          .setPlaceholder("Tell us why you want to join the staff team.")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(1500),
      ),
    );
}

function secondStepModal(): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(SECOND_STEP_MODAL_ID)
    .setTitle("Complete Your Application")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("timezone")
          .setLabel("What timezone are you in and where from?")
          .setPlaceholder("Example: IST (India)")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(500),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("partnerships")
          .setLabel("How many partnerships can you do?")
          .setPlaceholder("Tell us how many partnerships you can arrange.")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(500),
      ),
    );
}

function isReviewer(interaction: ButtonInteraction): boolean {
  return Boolean(
    interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ||
      interaction.memberPermissions?.has(PermissionFlagsBits.ManageRoles),
  );
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength
    ? `${value.slice(0, maxLength - 1)}…`
    : value;
}

async function getTextChannel(channelId: string): Promise<SendableChannels> {
  const channel = await client.channels.fetch(channelId);
  if (
    !channel ||
    !channel.isTextBased() ||
    !channel.isSendable() ||
    !("messages" in channel)
  ) {
    throw new Error(
      `Discord channel ${channelId} is not a sendable text channel.`,
    );
  }
  return channel;
}

async function ensureTicketPanel(): Promise<void> {
  const channel = await getTextChannel(TICKET_PANEL_CHANNEL_ID);
  const recentMessages = await channel.messages.fetch({ limit: 50 });
  const existingPanel = recentMessages.find(
    (message) =>
      message.author.id === client.user?.id &&
      message.embeds.some((embed) => embed.title === "🎫 Ticket Support"),
  );

  if (existingPanel) {
    await existingPanel.edit({
      embeds: [ticketPanelEmbed],
      components: [ticketPanelButtons()],
      allowedMentions: { parse: [] },
    });
    logger.info(
      { channelId: TICKET_PANEL_CHANNEL_ID },
      "Ticket panel updated",
    );
    return;
  }

  await channel.send({
    embeds: [ticketPanelEmbed],
    components: [ticketPanelButtons()],
    allowedMentions: { parse: [] },
  });
  logger.info({ channelId: TICKET_PANEL_CHANNEL_ID }, "Ticket panel sent");
}

async function handleTicketOpenButton(
  interaction: ButtonInteraction,
  type: TicketKind,
): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({
      content: "Tickets can only be opened inside the server.",
      ephemeral: true,
    });
    return;
  }
  await interaction.showModal(ticketModal(type));
}

function ticketDetailsEmbed(
  type: TicketKind,
  details: Record<string, string>,
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(type === "partnership" ? 0x5865f2 : 0x3498db)
    .setTitle(`${type[0].toUpperCase()}${type.slice(1)} ticket details`);

  if (type === "partnership") {
    embed.addFields(
      { name: "Server members", value: details.memberCount ?? "Not provided" },
      { name: "Server topic", value: truncate(details.serverTopic ?? "", 1024) },
      { name: "Server invite", value: truncate(details.serverInvite ?? "", 1024) },
    );
  } else if (type === "support") {
    embed.addFields({
      name: "Question",
      value: truncate(details.question ?? "", 1024),
    });
  } else {
    embed.addFields(
      {
        name: "Discord username",
        value: truncate(details.reportedUsername ?? "", 1024),
      },
      { name: "In-game name", value: truncate(details.reportedIgn ?? "", 1024) },
      { name: "What happened?", value: truncate(details.incident ?? "", 1024) },
    );
  }

  return embed;
}

function partnershipReviewEmbed(
  ticket: typeof ticketsTable.$inferSelect,
): EmbedBuilder {
  const embed = ticketDetailsEmbed("partnership", ticket.details)
    .setTitle("🤝 Partnership application")
    .setDescription(`Submitted by <@${ticket.userId}>`)
    .setFooter({ text: "Two distinct staff rejections will close this ticket." })
    .setTimestamp();

  if (ticket.screenshotUrl) {
    embed.setImage(ticket.screenshotUrl);
  }
  return embed;
}

function ticketChannelName(type: TicketKind, username: string): string {
  const safeUsername =
    username
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 75) || "member";
  return `${type}-${safeUsername}`.slice(0, 100);
}

async function handleTicketFormSubmit(
  interaction: ModalSubmitInteraction,
  type: TicketKind,
): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({
      content: "Tickets can only be opened inside the server.",
      ephemeral: true,
    });
    return;
  }

  const details: Record<string, string> = {};
  let memberCount: number | null = null;
  if (type === "partnership") {
    const memberCountInput = interaction.fields
      .getTextInputValue("member_count")
      .trim();
    if (!/^\d+$/.test(memberCountInput)) {
      await interaction.reply({
        content: "Please enter the server member count as a whole number.",
        ephemeral: true,
      });
      return;
    }
    memberCount = Number(memberCountInput);
    if (!Number.isSafeInteger(memberCount) || memberCount < 0) {
      await interaction.reply({
        content: "Please enter a valid non-negative server member count.",
        ephemeral: true,
      });
      return;
    }
    details.memberCount = String(memberCount);
    details.serverTopic = interaction.fields
      .getTextInputValue("server_topic")
      .trim();
    details.serverInvite = interaction.fields
      .getTextInputValue("server_invite")
      .trim();
  } else if (type === "support") {
    details.question = interaction.fields.getTextInputValue("question").trim();
  } else {
    details.reportedUsername = interaction.fields
      .getTextInputValue("reported_username")
      .trim();
    details.reportedIgn = interaction.fields.getTextInputValue("reported_ign").trim();
    details.incident = interaction.fields.getTextInputValue("incident").trim();
  }

  if (Object.values(details).some((answer) => answer.length === 0)) {
    await interaction.reply({
      content: "Please answer every question before submitting the ticket.",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  let ticketChannel:
    | Awaited<ReturnType<typeof interaction.guild.channels.create>>
    | undefined;
  try {
    const category = await interaction.guild.channels.fetch(TICKET_CATEGORY_ID);
    if (!category || category.type !== ChannelType.GuildCategory) {
      throw new Error("Configured ticket category was not found.");
    }

    const botMember = interaction.guild.members.me;
    ticketChannel = await interaction.guild.channels.create({
      name: ticketChannelName(type, interaction.user.username),
      type: ChannelType.GuildText,
      parent: TICKET_CATEGORY_ID,
      topic: `${type} ticket for ${interaction.user.tag} (${interaction.user.id})`,
      permissionOverwrites: [
        {
          id: interaction.guild.id,
          deny: [PermissionFlagsBits.ViewChannel],
        },
        {
          id: interaction.user.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.AttachFiles,
            PermissionFlagsBits.EmbedLinks,
          ],
        },
        {
          id: TICKET_REVIEW_ROLE_ID,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.AttachFiles,
            PermissionFlagsBits.EmbedLinks,
            PermissionFlagsBits.ManageMessages,
          ],
        },
        ...(botMember
          ? [
              {
                id: botMember.id,
                allow: [
                  PermissionFlagsBits.ViewChannel,
                  PermissionFlagsBits.SendMessages,
                  PermissionFlagsBits.ReadMessageHistory,
                  PermissionFlagsBits.AttachFiles,
                  PermissionFlagsBits.EmbedLinks,
                  PermissionFlagsBits.ManageChannels,
                  PermissionFlagsBits.ManageMessages,
                ],
              },
            ]
          : []),
      ],
      reason: `${type} ticket opened by ${interaction.user.tag}`,
    });

    await db.insert(ticketsTable).values({
      channelId: ticketChannel.id,
      guildId: interaction.guild.id,
      userId: interaction.user.id,
      type,
      status: type === "partnership" ? "awaiting_screenshot" : "open",
      details,
      memberCount,
    });

    await ticketChannel.send({
      content: `<@${interaction.user.id}> Your **${type}** ticket is open. A staff member will get back to you.`,
      embeds: [ticketDetailsEmbed(type, details)],
      components: [ticketCloseButtonRow(ticketChannel.id)],
      allowedMentions: { users: [interaction.user.id] },
    });

    if (type === "partnership") {
      await ticketChannel.send({
        content:
          "Please copy the advertisement below and post it in your server. Then send a screenshot here showing the posted advertisement. Staff will review your application after you upload the screenshot.",
        allowedMentions: { parse: [] },
      });
      await ticketChannel.send({
        content: partnershipAdvertisement,
        allowedMentions: { parse: [] },
      });
    }

    await interaction.editReply(
      `Your ticket has been created: <#${ticketChannel.id}>`,
    );
    logger.info(
      { channelId: ticketChannel.id, userId: interaction.user.id, type },
      "Ticket created",
    );
  } catch (error) {
    logger.error({ err: error, type, userId: interaction.user.id }, "Could not create ticket");
    if (ticketChannel) {
      await db
        .delete(ticketsTable)
        .where(eq(ticketsTable.channelId, ticketChannel.id))
        .catch(() => undefined);
      await ticketChannel.delete("Ticket setup failed").catch(() => undefined);
    }
    await interaction.editReply(
      "I could not create your ticket. Please check that I have permission to manage channels in the ticket category.",
    );
  }
}

async function handleTicketScreenshot(message: import("discord.js").Message): Promise<void> {
  if (message.author.bot || !message.guildId || message.attachments.size === 0) {
    return;
  }
  const screenshot = message.attachments.find(
    (attachment) =>
      attachment.contentType?.startsWith("image/") ||
      /\.(png|jpe?g|gif|webp)$/i.test(attachment.name ?? ""),
  );
  if (!screenshot) {
    return;
  }

  const ticketRows = await db
    .select({ channelId: ticketsTable.channelId, userId: ticketsTable.userId })
    .from(ticketsTable)
    .where(
      and(
        eq(ticketsTable.channelId, message.channelId),
        eq(ticketsTable.type, "partnership"),
        eq(ticketsTable.status, "awaiting_screenshot"),
      ),
    )
    .limit(1);
  const openTicket = ticketRows[0];
  if (!openTicket || openTicket.userId !== message.author.id) {
    return;
  }

  const updated = await db
    .update(ticketsTable)
    .set({ status: "pending_review", screenshotUrl: screenshot.url })
    .where(
      and(
        eq(ticketsTable.channelId, message.channelId),
        eq(ticketsTable.type, "partnership"),
        eq(ticketsTable.status, "awaiting_screenshot"),
      ),
    )
    .returning();
  const ticket = updated[0];
  if (!ticket) {
    return;
  }

  try {
    const ticketChannel = await getTextChannel(message.channelId);
    await ticketChannel.send({
      content: `<@${ticket.userId}> Screenshot received. Your partnership application is ready for staff review.`,
      embeds: [partnershipReviewEmbed(ticket)],
      components: [ticketReviewButtonRow(ticket.channelId)],
      allowedMentions: { users: [ticket.userId] },
    });
  } catch (error) {
    await db
      .update(ticketsTable)
      .set({ status: "awaiting_screenshot", screenshotUrl: null })
      .where(
        and(
          eq(ticketsTable.channelId, ticket.channelId),
          eq(ticketsTable.status, "pending_review"),
        ),
      );
    throw error;
  }
}

async function closeTicketChannel(
  ticket: typeof ticketsTable.$inferSelect,
): Promise<void> {
  const channel = await client.channels.fetch(ticket.channelId);
  if (!channel || channel.type !== ChannelType.GuildText) {
    throw new Error("Ticket channel could not be found.");
  }
  await channel.permissionOverwrites.edit(ticket.userId, {
    SendMessages: false,
    AttachFiles: false,
  });
  if (!channel.name.startsWith("closed-")) {
    await channel.setName(`closed-${channel.name}`.slice(0, 100));
  }
}

async function restoreInFlightTicketReviews(): Promise<void> {
  const restored = await db
    .update(ticketsTable)
    .set({ status: "pending_review" })
    .where(eq(ticketsTable.status, "publishing"))
    .returning({ channelId: ticketsTable.channelId });
  if (restored.length > 0) {
    logger.warn(
      { count: restored.length },
      "Restored partnership reviews interrupted during publication",
    );
  }
}

async function isTicketReviewer(interaction: ButtonInteraction): Promise<boolean> {
  if (!interaction.guild) {
    return false;
  }
  const member = await interaction.guild.members.fetch(interaction.user.id);
  return member.roles.cache.has(TICKET_REVIEW_ROLE_ID);
}

async function handleTicketAccept(
  interaction: ButtonInteraction,
  channelId: string,
): Promise<void> {
  if (!(await isTicketReviewer(interaction))) {
    await interaction.reply({
      content: "Only members with the designated partnership review role can decide these applications.",
      ephemeral: true,
    });
    return;
  }
  await interaction.deferReply({ ephemeral: true });

  const tickets = await db
    .select()
    .from(ticketsTable)
    .where(
      and(
        eq(ticketsTable.channelId, channelId),
        eq(ticketsTable.type, "partnership"),
        eq(ticketsTable.status, "pending_review"),
      ),
    )
    .limit(1);
  const ticket = tickets[0];
  if (!ticket) {
    await interaction.editReply("This partnership application is no longer pending.");
    return;
  }

  const claimed = await db
    .update(ticketsTable)
    .set({ status: "publishing" })
    .where(
      and(
        eq(ticketsTable.channelId, channelId),
        eq(ticketsTable.status, "pending_review"),
      ),
    )
    .returning({ channelId: ticketsTable.channelId });
  if (claimed.length === 0) {
    await interaction.editReply("Another staff member is already processing this application.");
    return;
  }

  try {
    const announcementChannel = await getTextChannel(PARTNERSHIP_AD_CHANNEL_ID);
    const count = ticket.memberCount ?? 0;
    let mention = "";
    let allowedMentions: { parse: ("everyone")[] } | { parse: [] } = { parse: [] };

    if (count >= 40) {
      mention = "@here";
      allowedMentions = { parse: ["everyone"] };
    }

    await announcementChannel.send({
      content: `${mention ? `${mention}\n` : ""}${partnershipAdvertisement}`,
      allowedMentions,
    });
    await db
      .update(ticketsTable)
      .set({ status: "accepted" })
      .where(
        and(
          eq(ticketsTable.channelId, channelId),
          eq(ticketsTable.status, "publishing"),
        ),
      );

    const embed = interaction.message.embeds[0]
      ? EmbedBuilder.from(interaction.message.embeds[0])
      : new EmbedBuilder().setTitle("Partnership application");
    embed
      .setColor(0x2ecc71)
      .addFields({
        name: "Decision",
        value: `Accepted by ${interaction.user.tag}. The advertisement was posted.`,
      })
      .setFooter({ text: "Partnership accepted" });
    await interaction.message.edit({
      embeds: [embed],
      components: [ticketReviewButtonRow(channelId, true)],
    });
    await interaction.editReply("Partnership accepted and the advertisement was posted.");
  } catch (error) {
    await db
      .update(ticketsTable)
      .set({ status: "pending_review" })
      .where(
        and(
          eq(ticketsTable.channelId, channelId),
          eq(ticketsTable.status, "publishing"),
        ),
      );
    logger.error({ err: error, channelId }, "Could not publish partnership advertisement");
    await interaction.editReply(
      "I could not post the advertisement. The application is still pending review.",
    );
  }
}

async function handleTicketReject(
  interaction: ButtonInteraction,
  channelId: string,
): Promise<void> {
  if (!(await isTicketReviewer(interaction))) {
    await interaction.reply({
      content: "Only members with the designated partnership review role can decide these applications.",
      ephemeral: true,
    });
    return;
  }
  await interaction.deferReply({ ephemeral: true });

  const tickets = await db
    .select()
    .from(ticketsTable)
    .where(
      and(
        eq(ticketsTable.channelId, channelId),
        eq(ticketsTable.type, "partnership"),
        eq(ticketsTable.status, "pending_review"),
      ),
    )
    .limit(1);
  const ticket = tickets[0];
  if (!ticket) {
    await interaction.editReply("This partnership application is no longer pending.");
    return;
  }

  const vote = await db
    .insert(ticketRejectionsTable)
    .values({ channelId, staffId: interaction.user.id })
    .onConflictDoNothing()
    .returning({ staffId: ticketRejectionsTable.staffId });
  if (vote.length === 0) {
    await interaction.editReply("Your rejection has already been counted.");
    return;
  }

  const rejectionRows = await db
    .select({ staffId: ticketRejectionsTable.staffId })
    .from(ticketRejectionsTable)
    .where(eq(ticketRejectionsTable.channelId, channelId));
  if (rejectionRows.length < TICKET_REJECTION_THRESHOLD) {
    const embed = interaction.message.embeds[0]
      ? EmbedBuilder.from(interaction.message.embeds[0])
      : new EmbedBuilder().setTitle("Partnership application");
    const existingFields = (embed.data.fields ?? []).filter(
      (field) => field.name !== "Rejection votes",
    );
    embed.setFields(
      ...existingFields,
      {
        name: "Rejection votes",
        value: `${rejectionRows.length}/${TICKET_REJECTION_THRESHOLD}`,
      },
    );
    await interaction.message.edit({ embeds: [embed] });
    await interaction.editReply(
      `Your rejection was counted. ${rejectionRows.length}/${TICKET_REJECTION_THRESHOLD} staff rejections are needed to close this ticket.`,
    );
    return;
  }

  const rejected = await db
    .update(ticketsTable)
    .set({ status: "rejected", closedAt: new Date() })
    .where(
      and(
        eq(ticketsTable.channelId, channelId),
        eq(ticketsTable.status, "pending_review"),
      ),
    )
    .returning();
  if (rejected.length === 0) {
    await interaction.editReply("This application has already been decided.");
    return;
  }

  const embed = interaction.message.embeds[0]
    ? EmbedBuilder.from(interaction.message.embeds[0])
    : new EmbedBuilder().setTitle("Partnership application");
  const existingFields = (embed.data.fields ?? []).filter(
    (field) => field.name !== "Rejection votes" && field.name !== "Decision",
  );
  embed
    .setColor(0xe74c3c)
    .setFields(
      ...existingFields,
      { name: "Rejection votes", value: `${TICKET_REJECTION_THRESHOLD}/${TICKET_REJECTION_THRESHOLD}` },
      {
        name: "Decision",
        value: `Rejected by two staff members (most recent vote by ${interaction.user.tag}).`,
      },
    )
    .setFooter({ text: "Partnership rejected" });

  let ticketClosed = true;
  try {
    await closeTicketChannel(rejected[0]);
  } catch (error) {
    ticketClosed = false;
    logger.error({ err: error, channelId }, "Could not lock rejected partnership ticket");
  }

  try {
    await interaction.message.edit({
      embeds: [embed],
      components: [ticketReviewButtonRow(channelId, true)],
    });
  } catch (error) {
    logger.error({ err: error, channelId }, "Could not update rejected partnership review");
  }

  let dmSent = true;
  try {
    const applicant = await client.users.fetch(ticket.userId);
    await applicant.send(
      "Your partnership application was rejected by two staff members. The ticket has been closed. If you have questions, please contact the staff team.",
    );
  } catch (error) {
    dmSent = false;
    logger.warn(
      { err: error, userId: ticket.userId, channelId },
      "Could not DM partnership applicant about rejection",
    );
  }
  await interaction.editReply(
    ticketClosed
      ? dmSent
        ? "Two staff members rejected the application. The ticket is closed and the applicant was notified."
        : "Two staff members rejected the application and the ticket is closed, but I could not DM the applicant."
      : "Two staff members rejected the application, but I could not lock the ticket channel. Check the bot's Manage Channels permission.",
  );
}

async function handleTicketClose(
  interaction: ButtonInteraction,
  channelId: string,
): Promise<void> {
  const ticketRows = await db
    .select()
    .from(ticketsTable)
    .where(eq(ticketsTable.channelId, channelId))
    .limit(1);
  const ticket = ticketRows[0];
  if (!ticket) {
    await interaction.reply({
      content: "This ticket could not be found.",
      ephemeral: true,
    });
    return;
  }
  const reviewer = await isTicketReviewer(interaction);
  if (interaction.user.id !== ticket.userId && !reviewer) {
    await interaction.reply({
      content: "Only the ticket creator or the ticket review staff can close this ticket.",
      ephemeral: true,
    });
    return;
  }
  if (ticket.closedAt) {
    await interaction.reply({ content: "This ticket is already closed.", ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  const closed = await db
    .update(ticketsTable)
    .set({ status: "closed", closedAt: new Date() })
    .where(
      and(
        eq(ticketsTable.channelId, channelId),
        isNull(ticketsTable.closedAt),
      ),
    )
    .returning();
  if (closed.length === 0) {
    await interaction.editReply("This ticket is already closed.");
    return;
  }

  await closeTicketChannel(closed[0]);
  await interaction.message.edit({
    components: [ticketCloseButtonRow(channelId, true)],
  });
  await interaction.editReply("Ticket closed.");
}

async function ensureApplicationPanel(): Promise<void> {
  const channel = await getTextChannel(APPLICATION_CHANNEL_ID);
  const recentMessages = await channel.messages.fetch({ limit: 50 });
  const existingPanel = recentMessages.find(
    (message) =>
      message.author.id === client.user?.id &&
      message.embeds.some(
        (embed) => embed.title === "📋 Trainee Staff Application",
      ),
  );

  if (existingPanel) {
    await existingPanel.edit({
      embeds: [applicationPanelEmbed],
      components: [applicationButtonRow()],
      allowedMentions: { parse: [] },
    });
    logger.info({ channelId: APPLICATION_CHANNEL_ID }, "Application panel updated");
    return;
  }

  await channel.send({
    embeds: [applicationPanelEmbed],
    components: [applicationButtonRow()],
    allowedMentions: { parse: [] },
  });
  logger.info({ channelId: APPLICATION_CHANNEL_ID }, "Application panel sent");
}

function applicationReviewEmbed(
  userId: string,
  userTag: string,
  answers: PendingApplication,
  secondStepAnswers: { timezone: string; partnerships: string },
): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle("📋 Trainee Staff Application — Review")
    .setDescription(`Application submitted by **${userTag}** (\`${userId}\`)`)
    .addFields(
      { name: "1. IGN", value: truncate(answers.ign, 1024), inline: true },
      { name: "2. Age", value: truncate(answers.age, 1024), inline: true },
      {
        name: "3. Why do you want to apply for staff position?",
        value: truncate(answers.motivation, 1024),
      },
      {
        name: "4. What timezones are you in, and where are you from?",
        value: truncate(secondStepAnswers.timezone, 1024),
      },
      {
        name: "5. How many partnerships can you do?",
        value: truncate(secondStepAnswers.partnerships, 1024),
      },
    )
    .setFooter({ text: "Use the buttons below to make a decision." })
    .setTimestamp();
}

function reviewButtonRow(
  applicantId: string,
  messageId: string,
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`staff_accept:${applicantId}:${messageId}`)
      .setLabel("Accept")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`staff_deny:${applicantId}:${messageId}`)
      .setLabel("Deny")
      .setStyle(ButtonStyle.Danger),
  );
}

function completedReviewButtonRow(
  label: string,
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("staff_application_decided")
      .setLabel(label)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
  );
}

async function handleApplyButton(
  interaction: ButtonInteraction,
): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({
      content: "Applications can only be started inside the server.",
      ephemeral: true,
    });
    return;
  }

  const member = await interaction.guild.members.fetch(interaction.user.id);
  if (member.roles.cache.has(TRAINEE_ROLE_ID)) {
    await interaction.reply({
      content:
        "You already have the Trainee role, so you cannot submit another staff application.",
      ephemeral: true,
    });
    return;
  }

  const deniedAt = await getDenialTimestamp(interaction.user.id);
  const availableAt = deniedAt
    ? deniedAt.getTime() + DENIAL_COOLDOWN_MS
    : null;
  if (availableAt && availableAt > Date.now()) {
    await interaction.reply({
      content: `Your application was denied recently. You can apply again <t:${Math.floor(availableAt / 1000)}:R> (<t:${Math.floor(availableAt / 1000)}:F>).`,
      ephemeral: true,
    });
    return;
  }

  await interaction.showModal(firstStepModal());
}

async function handleContinueButton(
  interaction: ButtonInteraction,
): Promise<void> {
  if (!pendingApplications.has(interaction.user.id)) {
    await interaction.reply({
      content:
        "Your application session has expired. Please click **Apply** again to restart.",
      ephemeral: true,
    });
    return;
  }

  await interaction.showModal(secondStepModal());
}

async function handleFirstStepSubmit(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  pendingApplications.set(interaction.user.id, {
    userId: interaction.user.id,
    ign: interaction.fields.getTextInputValue("ign").trim(),
    age: interaction.fields.getTextInputValue("age").trim(),
    motivation: interaction.fields.getTextInputValue("motivation").trim(),
    startedAt: Date.now(),
  });

  await interaction.reply({
    content:
      "Your first three answers have been saved. Click **Complete** to answer the last two questions.",
    components: [continueButtonRow()],
    ephemeral: true,
  });
}

async function handleSecondStepSubmit(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  const pending = pendingApplications.get(interaction.user.id);
  if (!pending) {
    await interaction.reply({
      content:
        "Your application session has expired. Please click **Apply** again to restart.",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    if (!interaction.guild) {
      await interaction.editReply(
        "Applications can only be submitted inside the server.",
      );
      return;
    }

    const member = await interaction.guild.members.fetch(interaction.user.id);
    if (member.roles.cache.has(TRAINEE_ROLE_ID)) {
      pendingApplications.delete(interaction.user.id);
      await interaction.editReply(
        "You already have the Trainee role, so this application cannot be submitted.",
      );
      return;
    }

    const deniedAt = await getDenialTimestamp(interaction.user.id);
    const availableAt = deniedAt
      ? deniedAt.getTime() + DENIAL_COOLDOWN_MS
      : null;
    if (availableAt && availableAt > Date.now()) {
      pendingApplications.delete(interaction.user.id);
      await interaction.editReply(
        `You can apply again <t:${Math.floor(availableAt / 1000)}:R> (<t:${Math.floor(availableAt / 1000)}:F>).`,
      );
      return;
    }

    const reviewChannel = await getTextChannel(REVIEW_CHANNEL_ID);
    const reviewMessage = await reviewChannel.send({
      embeds: [
        applicationReviewEmbed(
          interaction.user.id,
          interaction.user.tag,
          pending,
          {
            timezone: interaction.fields.getTextInputValue("timezone").trim(),
            partnerships: interaction.fields
              .getTextInputValue("partnerships")
              .trim(),
          },
        ),
      ],
      allowedMentions: { parse: [] },
    });

    await reviewMessage.edit({
      components: [reviewButtonRow(interaction.user.id, reviewMessage.id)],
    });

    pendingApplications.delete(interaction.user.id);
    await interaction.editReply(
      "Your application has been submitted for review. Good luck!",
    );
  } catch (error) {
    logger.error({ err: error }, "Could not submit staff application");
    await interaction.editReply(
      "I could not submit your application right now. Please try again later.",
    );
  }
}

async function getDenialTimestamp(
  applicantId: string,
): Promise<Date | null> {
  const rows = await db
    .select({ deniedAt: staffApplicationDenialsTable.deniedAt })
    .from(staffApplicationDenialsTable)
    .where(eq(staffApplicationDenialsTable.applicantId, applicantId))
    .limit(1);

  return rows[0]?.deniedAt ?? null;
}

async function recordDenial(applicantId: string): Promise<void> {
  await db
    .insert(staffApplicationDenialsTable)
    .values({ applicantId, deniedAt: new Date() })
    .onConflictDoUpdate({
      target: staffApplicationDenialsTable.applicantId,
      set: { deniedAt: new Date() },
    });
}

function parseReviewButton(customId: string): {
  action: "accept" | "deny";
  applicantId: string;
  messageId: string;
} | null {
  const [action, applicantId, messageId] = customId.split(":");
  if (
    (action !== "staff_accept" && action !== "staff_deny") ||
    !applicantId ||
    !messageId
  ) {
    return null;
  }

  return {
    action: action === "staff_accept" ? "accept" : "deny",
    applicantId,
    messageId,
  };
}

async function handleAccept(
  interaction: ButtonInteraction,
  applicantId: string,
  messageId: string,
): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({
      content: "This action can only be used inside the server.",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    const member = await interaction.guild.members.fetch(applicantId);
    await member.roles.add(
      [TRAINEE_ROLE_ID, SECOND_STAFF_ROLE_ID],
      "Trainee staff application accepted",
    );

    let dmSent = true;
    try {
      await member.send(
        "Congratulations! Your Trainee Staff application has been accepted. You have been given the Trainee Staff roles. Welcome to the team!",
      );
    } catch (error) {
      dmSent = false;
      logger.warn(
        { err: error, applicantId },
        "Accepted applicant but could not send DM",
      );
    }

    const message = interaction.message;
    const embed = message.embeds[0]
      ? EmbedBuilder.from(message.embeds[0])
      : new EmbedBuilder().setTitle("Trainee Staff Application");
    embed
      .setColor(0x2ecc71)
      .addFields({
        name: "Decision",
        value: `Accepted by ${interaction.user.tag}`,
      })
      .setFooter({ text: "Application accepted" });

    await message.edit({
      embeds: [embed],
      components: [completedReviewButtonRow("Accepted")],
    });

    await interaction.editReply(
      dmSent
        ? "Application accepted and both staff roles were given."
        : "Application accepted and both staff roles were given, but I could not send the applicant a DM.",
    );
    logger.info(
      { applicantId, messageId },
      "Staff application accepted",
    );
  } catch (error) {
    logger.error({ err: error, applicantId }, "Could not accept staff application");
    await interaction.editReply(
      "I could not accept this application. Check that I have Manage Roles permission and that both roles are below my highest role.",
    );
  }
}

async function handleDenyButton(
  interaction: ButtonInteraction,
  applicantId: string,
  messageId: string,
): Promise<void> {
  const modal = new ModalBuilder()
    .setCustomId(`${DENY_REASON_MODAL_PREFIX}:${applicantId}:${messageId}`)
    .setTitle("Deny Staff Application")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("reason")
          .setLabel("Why are you denying this application?")
          .setPlaceholder("Give the applicant a helpful reason.")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(1000),
      ),
    );

  await interaction.showModal(modal);
}

async function handleDenyReasonSubmit(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  const parts = interaction.customId.split(":");
  const applicantId = parts[1];
  const messageId = parts[2];
  const reason = interaction.fields.getTextInputValue("reason").trim();

  if (!applicantId || !messageId) {
    await interaction.reply({
      content: "This denial request is no longer valid.",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    await recordDenial(applicantId);
  } catch (error) {
    logger.error(
      { err: error, applicantId },
      "Could not save application denial cooldown",
    );
    await interaction.editReply(
      "I could not save the denial decision. The applicant was not notified.",
    );
    return;
  }

  let dmSent = true;
  try {
    const applicant = await client.users.fetch(applicantId);
    await applicant.send(
      `Your Trainee Staff application was denied.\n\nReason from the staff team: ${reason}`,
    );
  } catch (error) {
    dmSent = false;
    logger.warn(
      { err: error, applicantId },
      "Denied application but could not send DM",
    );
  }

  try {
    const message = await interaction.channel?.messages.fetch(messageId);
    if (message) {
      const embed = message.embeds[0]
        ? EmbedBuilder.from(message.embeds[0])
        : new EmbedBuilder().setTitle("Trainee Staff Application");
      embed
        .setColor(0xe74c3c)
        .addFields({
          name: "Decision",
          value: `Denied by ${interaction.user.tag}\nReason: ${truncate(reason, 900)}`,
        })
        .setFooter({ text: "Application denied" });

      await message.edit({
        embeds: [embed],
        components: [completedReviewButtonRow("Denied")],
      });
    }
  } catch (error) {
    logger.error({ err: error, messageId }, "Could not update denied application");
  }

  await interaction.editReply(
    dmSent
      ? "Application denied and the applicant was notified by DM."
      : "Application denied, but I could not send the applicant a DM.",
  );
}

client.on(Events.MessageCreate, async (message) => {
  try {
    await handleTicketScreenshot(message);
  } catch (error) {
    logger.error(
      { err: error, channelId: message.channelId, messageId: message.id },
      "Could not process ticket screenshot",
    );
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === GIVEAWAY_COMMAND_NAME) {
        await handleGiveawayCommand(interaction);
      }
      return;
    }

    if (interaction.isButton()) {
      if (interaction.customId.startsWith(TICKET_OPEN_PREFIX)) {
        const type = interaction.customId.slice(
          TICKET_OPEN_PREFIX.length,
        ) as TicketKind;
        if (type === "partnership" || type === "support" || type === "report") {
          await handleTicketOpenButton(interaction, type);
        }
        return;
      }

      if (interaction.customId.startsWith(TICKET_ACCEPT_PREFIX)) {
        await handleTicketAccept(
          interaction,
          interaction.customId.slice(TICKET_ACCEPT_PREFIX.length),
        );
        return;
      }

      if (interaction.customId.startsWith(TICKET_REJECT_PREFIX)) {
        await handleTicketReject(
          interaction,
          interaction.customId.slice(TICKET_REJECT_PREFIX.length),
        );
        return;
      }

      if (interaction.customId.startsWith(TICKET_CLOSE_PREFIX)) {
        await handleTicketClose(
          interaction,
          interaction.customId.slice(TICKET_CLOSE_PREFIX.length),
        );
        return;
      }

      if (interaction.customId.startsWith(GIVEAWAY_ENTER_PREFIX)) {
        await handleGiveawayEntry(
          interaction,
          interaction.customId.slice(GIVEAWAY_ENTER_PREFIX.length),
        );
        return;
      }

      if (interaction.customId === APPLY_BUTTON_ID) {
        await handleApplyButton(interaction);
        return;
      }

      if (interaction.customId === CONTINUE_BUTTON_ID) {
        await handleContinueButton(interaction);
        return;
      }

      const reviewButton = parseReviewButton(interaction.customId);
      if (!reviewButton) {
        return;
      }

      if (!isReviewer(interaction)) {
        await interaction.reply({
          content:
            "Only staff members with Manage Server or Manage Roles can review applications.",
          ephemeral: true,
        });
        return;
      }

      if (reviewButton.action === "accept") {
        await handleAccept(
          interaction,
          reviewButton.applicantId,
          reviewButton.messageId,
        );
      } else {
        await handleDenyButton(
          interaction,
          reviewButton.applicantId,
          reviewButton.messageId,
        );
      }
      return;
    }

    if (!interaction.isModalSubmit()) {
      return;
    }

    if (interaction.customId.startsWith(TICKET_MODAL_PREFIX)) {
      const type = interaction.customId.slice(TICKET_MODAL_PREFIX.length);
      if (type === "partnership" || type === "support" || type === "report") {
        await handleTicketFormSubmit(interaction, type);
      }
      return;
    }

    if (interaction.customId === FIRST_STEP_MODAL_ID) {
      await handleFirstStepSubmit(interaction);
      return;
    }

    if (interaction.customId === SECOND_STEP_MODAL_ID) {
      await handleSecondStepSubmit(interaction);
      return;
    }

    if (interaction.customId === GIVEAWAY_MODAL_ID) {
      await handleGiveawaySubmit(interaction);
      return;
    }

    if (interaction.customId.startsWith(`${DENY_REASON_MODAL_PREFIX}:`)) {
      if (
        !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) &&
        !interaction.memberPermissions?.has(PermissionFlagsBits.ManageRoles)
      ) {
        await interaction.reply({
          content:
            "Only staff members with Manage Server or Manage Roles can review applications.",
          ephemeral: true,
        });
        return;
      }
      await handleDenyReasonSubmit(interaction);
    }
  } catch (error) {
    logger.error({ err: error }, "Discord interaction failed");
    if (
      interaction.isRepliable() &&
      !interaction.replied &&
      !interaction.deferred
    ) {
      await interaction.reply({
        content: "Something went wrong while handling that action.",
        ephemeral: true,
      });
    }
  }
});

client.once(Events.ClientReady, (readyClient) => {
  readyClient.user.setPresence({
    activities: [
      {
        name: "Made by Kayzo for MCPE Community",
        type: ActivityType.Listening,
      },
    ],
    status: "online",
  });
  logger.info({ user: readyClient.user.tag }, "Discord bot connected");
  void Promise.all([
    ensureApplicationPanel(),
    ensureTicketPanel(),
    registerGiveawayCommands(),
    restoreActiveGiveaways(),
    restoreInFlightTicketReviews(),
  ]).catch((error) => {
    logger.error(
      { err: error },
      "Could not initialize Discord application features",
    );
  });
});

export async function startDiscordBot(): Promise<void> {
  const token = process.env["DISCORD_BOT_TOKEN"];
  if (!token) {
    logger.warn(
      "DISCORD_BOT_TOKEN is not set; Discord staff applications are disabled until the secret is added.",
    );
    return;
  }

  try {
    await client.login(token);
  } catch (error) {
    logger.error({ err: error }, "Discord bot could not log in");
  }
}