import express, { Router } from "express";
import {
  AccessToken,
  EgressClient,
  RoomServiceClient,
  StreamOutput,
  StreamProtocol,
  WebhookReceiver,
} from "livekit-server-sdk";
import { v4 as uuid } from "uuid";
import { authorizer, validatePost } from "../middleware";
import { db } from "../store";
import {
  BadRequestError,
  ForbiddenError,
  InternalServerError,
  NotFoundError,
} from "../store/errors";
import { Room } from "../schema/types";

const app = Router();

app.post("/", authorizer({}), async (req, res) => {
  if (req.config.livekitHost == "") {
    res.status(400);
    return res.send("not enabled");
  }

  const id = uuid();
  const svc = new RoomServiceClient(
    req.config.livekitHost,
    req.config.livekitApiKey,
    req.config.livekitSecret
  );
  const room = await svc.createRoom({
    name: id,
    // timeout in seconds
    emptyTimeout: 15 * 60,
    maxParticipants: 10,
    metadata: JSON.stringify({ userId: req.user.id }),
  });
  console.log("livekit room created", room);

  await db.room.create({
    id: id,
    userId: req.user.id,
    createdAt: Date.now(),
    participants: {},
    events: [],
  });

  res.status(201);
  res.json({
    id: id,
  });
});

async function getRoom(req) {
  const room = await db.room.get(req.params.roomId);
  if (!room || room.deleted) {
    throw new NotFoundError(`room not found`);
  }

  if (!req.user.admin && req.user.id !== room.userId) {
    throw new ForbiddenError(`invalid user`);
  }
  return room;
}

app.get("/:roomId", authorizer({}), async (req, res) => {
  const room = await getRoom(req);

  res.status(200).json(toExternalRoom(room, req.user.admin));
});

function toExternalRoom(room: Room, isAdmin = false) {
  if (isAdmin) {
    return room;
  }
  const roomForResp = {
    id: room.id,
    updatedAt: room.updatedAt,
    createdAt: room.createdAt,
    participants: room.participants,
  };

  for (const key in roomForResp.participants) {
    roomForResp.participants[key].tracksPublished = undefined;
  }
  return roomForResp;
}

app.delete("/:roomId", authorizer({}), async (req, res) => {
  const room = await getRoom(req);

  const svc = new RoomServiceClient(
    req.config.livekitHost,
    req.config.livekitApiKey,
    req.config.livekitSecret
  );
  await svc.deleteRoom(req.params.roomId);

  await db.room.update(room.id, { deleted: true, deletedAt: Date.now() });

  res.status(204).end();
});

app.post(
  "/:roomId/egress",
  authorizer({}),
  validatePost("room-egress-payload"),
  async (req, res) => {
    const room = await getRoom(req);

    if (room.egressId !== undefined && room.egressId != "") {
      throw new BadRequestError("egress already started");
    }

    const stream = await db.stream.get(req.body.streamId);
    if (
      !stream ||
      stream.deleted ||
      (!req.user.admin && req.user.id !== stream.userId)
    ) {
      throw new NotFoundError(`stream not found`);
    }

    const egressClient = new EgressClient(
      req.config.livekitHost,
      req.config.livekitApiKey,
      req.config.livekitSecret
    );
    const output: StreamOutput = {
      protocol: StreamProtocol.RTMP,
      urls: [req.config.ingest[0].ingest + "/" + stream.streamKey],
    };

    const info = await egressClient.startRoomCompositeEgress(
      req.params.roomId,
      output,
      {
        layout: "speaker-dark",
        encodingOptions: {
          keyFrameInterval: 2,
        },
      }
    );
    console.log("egress started", info);
    await db.room.update(room.id, {
      egressId: info.egressId,
      updatedAt: Date.now(),
    });
    res.status(204).end();
  }
);

app.delete("/:roomId/egress", authorizer({}), async (req, res) => {
  const room = await getRoom(req);

  if (room.egressId === undefined || room.egressId == "") {
    throw new BadRequestError("egress has not started");
  }

  const egressClient = new EgressClient(
    req.config.livekitHost,
    req.config.livekitApiKey,
    req.config.livekitSecret
  );

  const info = await egressClient.stopEgress(room.egressId);
  console.log("egress stopped", info);
  await db.room.update(room.id, { egressId: "", updatedAt: Date.now() });
  res.status(204).end();
});

app.post(
  "/:roomId/user",
  authorizer({}),
  validatePost("room-user-payload"),
  async (req, res) => {
    await getRoom(req);

    const id = uuid();
    const at = new AccessToken(
      req.config.livekitApiKey,
      req.config.livekitSecret,
      {
        name: req.body.name,
        identity: id,
        ttl: 5 * 60,
      }
    );
    at.addGrant({ roomJoin: true, room: req.params.roomId });
    const token = at.toJwt();

    res.status(201);
    res.json({
      id: id,
      joinUrl:
        req.config.livekitMeetUrl +
        "?liveKitUrl=" +
        req.config.livekitHost +
        "&token=" +
        token,
      token: token,
    });
  }
);

app.delete("/:roomId/user/:participantId", authorizer({}), async (req, res) => {
  await getRoom(req);

  const svc = new RoomServiceClient(
    req.config.livekitHost,
    req.config.livekitApiKey,
    req.config.livekitSecret
  );
  await svc.removeParticipant(req.params.roomId, req.params.participantId);

  res.status(204).end();
});

// Implement a webhook handler to receive webhooks from Livekit to update our state with room and participant details.
app.post("/webhook", express.raw({ type: "*/*" }), async (req, res) => {
  const receiver = new WebhookReceiver(
    req.config.livekitApiKey,
    req.config.livekitSecret
  );

  // event is a WebhookEvent object
  let event;
  try {
    event = receiver.receive(req.body, req.get("Authorization"));
  } catch (e) {
    console.log(
      "failed to receive room webhook. auth:",
      req.get("Authorization")
    );
    throw e;
  }

  let roomId;
  if (event.room && event.room.name) {
    roomId = event.room.name;
  } else if (event.egressInfo && event.egressInfo.roomName) {
    roomId = event.egressInfo.roomName;
  } else {
    throw new BadRequestError(`no room name on event`);
  }
  const room = await db.room.get(roomId);
  if (!room) {
    throw new InternalServerError(`room not found`);
  }

  switch (event.event) {
    case "track_published":
    case "participant_joined":
    case "participant_left":
      const svc = new RoomServiceClient(
        req.config.livekitHost,
        req.config.livekitApiKey,
        req.config.livekitSecret
      );
      const participants = await svc.listParticipants(roomId);

      for (const participant of participants) {
        if (room.participants[participant.identity] === undefined) {
          room.participants[participant.identity] = {
            identity: participant.identity,
            name: participant.name,
            joinedAt: participant.joinedAt * 1000,
            tracksPublished: {},
          };
        }
        if (event.event == "participant_left") {
          room.participants[participant.identity].leftAt = Date.now();
        }

        let tracks = room.participants[participant.identity].tracksPublished;
        for (const track of participant.tracks) {
          if (tracks[track.sid] !== undefined) {
            continue;
          }
          tracks[track.sid] = {
            sid: track.sid,
            height: track.height,
            width: track.width,
            mimeType: track.mimeType,
            timestamp: Date.now(),
          };
        }
      }
      room.updatedAt = Date.now();
      await db.room.replace(room);
      break;
    case "room_started":
    case "room_finished":
    case "egress_started":
    case "egress_ended":
      room.events.push({
        eventName: event.event,
        timestamp: Date.now(),
      });
      await db.room.update(room.id, {
        updatedAt: Date.now(),
        events: room.events,
      });
      break;
  }

  return res.status(204).end();
});

export default app;
