import { respondWithJSON } from "./json";

import { cfg, type ApiConfig } from "../config";
import { BunRequest, s3 } from "bun";
import { BadRequestError, UserForbiddenError } from "./errors";
import { getBearerToken, validateJWT } from "../auth";
import { getVideo, updateVideo } from "../db/videos";
import type { Video } from "../db/videos";
import path from "node:path"

export async function handlerUploadVideo(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  console.log("uploading video for video", videoId, "by user", userID);

  const videoData = getVideo(cfg.db, videoId);
  if(!videoData)
  {
    throw new Error("Cannot find video");
  }
  const data = await req.formData();
  const video = data.get("video");
  const MAX_UPLOAD_SIZE = 10 << 23; //1GB
  if (video.size > MAX_UPLOAD_SIZE) 
  {
    console.log(video.size);
    console.log(MAX_UPLOAD_SIZE)
    throw new BadRequestError(
      `Video file exceeds the maximum allowed size of 1GB`,
    );
  }

  if(!(video.type == "video/mp4"))
  {
    throw new BadRequestError("Not a video file type");
  }

  const buffer = await video.arrayBuffer();
  const filepath = path.join(cfg.assetsRoot, `temp`);
  await Bun.write(filepath, buffer);
  const AR = await getVideoAspecRatio(filepath);
  const processed =  await processVideoForFastStart(filepath);

  const s3file = cfg.s3client.file(`${AR}/${videoId}.mp4`);
  await s3file.write(await Bun.file(processed), {type: video.type});
  videoData.videoURL = `${AR}/${videoId}.mp4`

  updateVideo(cfg.db, videoData);

  await Bun.file(filepath).delete();
  await Bun.file(processed).delete();
  const signedVideo = dbVideoToSignedVideo(videoData);
  return respondWithJSON(200, signedVideo);
}

async function getVideoAspecRatio(filePath: string): Promise<string>
{
  const proc = Bun.spawn(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", filePath]);
  const result = await proc.stdout.text();

  if(await proc.exited != 0)
  {
    throw new Error("Bad ffmpeg call");
  }

  const resultObj = JSON.parse(result);
  const width = resultObj["streams"][0]["width"];
  const height = resultObj["streams"][0]["height"];

  if(Math.floor(width/height) == Math.floor(16/9))
  {
    return "landscape"
  }

  if(Math.floor(height/width) == Math.floor(16/9))
  {
    return "portrait"
  }
  return "other"
}

async function processVideoForFastStart(filePath: string)
{
  const outputPath = filePath + ".processed";
  const proc = Bun.spawn(["ffmpeg", "-i", filePath, "-movflags", "faststart", "-map_metadata", "0", "-codec", "copy", "-f", "mp4", outputPath]);
  if(await proc.exited != 0)
  {
    throw new Error("Cannot convert video file");
  }
  return outputPath;
}

async function generatePresignedURL(key: string, expireTime: number)
{
  const upload = await cfg.s3client.presign(key, {expiresIn: expireTime});
  console.log(upload);
  return upload;
}

export async function dbVideoToSignedVideo(video: Video)
{
  if(!video.videoURL)
  {
    throw new Error("No video URL");
  }

  const signedURL = await generatePresignedURL(video.videoURL, 3600);
  video.videoURL = signedURL;
  return video;
}

