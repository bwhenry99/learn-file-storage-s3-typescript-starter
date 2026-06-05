import { getBearerToken, validateJWT } from "../auth";
import { respondWithJSON } from "./json";
import { getVideo, updateVideo } from "../db/videos";
import type { ApiConfig } from "../config";
import type { BunRequest } from "bun";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import { Buffer } from "node:buffer"

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
  const buffer = Buffer.from(await image.arrayBuffer()).toString("Base64");

  const videoData = getVideo(cfg.db, videoId);
  if(!videoData)
  {
    throw new Error("Cannot find video");
  }

  if(videoData.userID != userID)
  {
    throw new UserForbiddenError("Not authorized to modify video");
  }

  const url = `data:${mediaType};base64,${buffer}`
  videoData.thumbnailURL = url;
  updateVideo(cfg.db, videoData);

  return respondWithJSON(200, videoData);
}
