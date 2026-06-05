import { getBearerToken, validateJWT } from "../auth";
import { respondWithJSON } from "./json";
import { getVideo, updateVideo } from "../db/videos";
import type { ApiConfig } from "../config";
import type { BunRequest } from "bun";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";

type Thumbnail = {
  data: ArrayBuffer;
  mediaType: string;
};

const videoThumbnails: Map<string, Thumbnail> = new Map();

export async function handlerGetThumbnail(cfg: ApiConfig, req: BunRequest) {
  let { videoId } = req.params as { videoId?: string };
  videoId = videoId?.slice(1);
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }
  console.log(videoId);
  const video = getVideo(cfg.db, videoId);
  if (!video) {
    throw new NotFoundError("Couldn't find video");
  }

  const thumbnail = videoThumbnails.get(videoId);
  if (!thumbnail) {
    throw new NotFoundError("Thumbnail not found");
  }

  return new Response(thumbnail.data, {
    headers: {
      "Content-Type": thumbnail.mediaType,
      "Cache-Control": "no-store",
    },
  });
}

export async function handlerUploadThumbnail(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  console.log("uploading thumbnail for video", videoId, "by user", userID);

  const data = await req.formData();
  const image = data.get("thumbnail");
  if (!(image instanceof File))
  {
    throw new BadRequestError("No thumbnail file");
  }
  const MAX_UPLOAD_SIZE = 10 << 20; //10MB
  if (image.size > MAX_UPLOAD_SIZE) 
  {
    throw new BadRequestError(
      `Thumbnail file exceeds the maximum allowed size of 10MB`,
    );
  }

  const mediaType = image.type;
  const buffer = await image.arrayBuffer();

  const videoData = getVideo(cfg.db, videoId);
  if(!videoData)
  {
    throw new Error("Cannot find video");
  }

  if(videoData.userID != userID)
  {
    throw new UserForbiddenError("Not authorized to modify video");
  }

  videoThumbnails.set(videoId, {data: buffer, mediaType});
  const url = `http://localhost:${cfg.port}/api/thumbnails/:${videoId}`
  videoData.thumbnailURL = url;
  updateVideo(cfg.db, videoData);

  return respondWithJSON(200, videoData);
}
