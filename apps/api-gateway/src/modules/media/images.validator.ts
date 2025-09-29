import { PipeTransform, Injectable, BadRequestException } from '@nestjs/common';
import { Express } from 'express';

interface FileValidationOptions {
  maxSizeMB?: number; // maximum size in MB
  allowedTypes?: string[]; // allowed mime types
  maxFiles?: number; // maximum number of files
  minFiles?: number; // minimum number of files
}

@Injectable()
export class ImageValidationPipe implements PipeTransform {
  constructor(private options: FileValidationOptions) {}

  transform(files: Express.Multer.File | Express.Multer.File[]) {
    const fileArray = Array.isArray(files) ? files : [files];

    // check number of files
    if (this.options.minFiles && fileArray.length < this.options.minFiles) {
      throw new BadRequestException(
        `You must upload at least ${this.options.minFiles} file(s).`
      );
    }
    if (this.options.maxFiles && fileArray.length > this.options.maxFiles) {
      throw new BadRequestException(
        `You can upload up to ${this.options.maxFiles} file(s) only.`
      );
    }

    fileArray.forEach((file) => {
      // check size
      if (
        this.options.maxSizeMB &&
        file.size > this.options.maxSizeMB * 1024 * 1024
      ) {
        throw new BadRequestException(
          `File ${file.originalname} is too large. Maximum size is ${this.options.maxSizeMB}MB.`
        );
      }

      // check type
      if (
        this.options.allowedTypes &&
        !this.options.allowedTypes.includes(file.mimetype)
      ) {
        throw new BadRequestException(
          `File ${file.originalname} has an invalid type. Allowed types: ${this.options.allowedTypes.join(', ')}.`
        );
      }
    });

    return files;
  }
}
