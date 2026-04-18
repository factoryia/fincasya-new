import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const s3Client = new S3Client({
  region: process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

async function uploadLogo() {
  const logoPath = "c:\\factory\\FincasYaWeb\\public\\fincas-ya-logo-2.png";
  const fileBuffer = fs.readFileSync(logoPath);
  const fileName = "app-assets/fincas-ya-logo-2.png";

  const command = new PutObjectCommand({
    Bucket: process.env.AWS_S3_BUCKET_NAME,
    Key: fileName,
    Body: fileBuffer,
    ContentType: "image/png",
  });

  try {
    await s3Client.send(command);
    const url = `https://${process.env.AWS_S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileName}`;
    console.log("Logo uploaded successfully!");
    console.log("URL:", url);
  } catch (err) {
    console.error("Error uploading logo:", err);
  }
}

uploadLogo();
