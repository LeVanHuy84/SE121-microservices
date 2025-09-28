import { ExceptionFilter, Catch, ArgumentsHost } from '@nestjs/common';
import { Request, Response } from 'express';
import { Neo4jError } from 'neo4j-driver';

@Catch(Neo4jError)
export class Neo4jErrorFilter implements ExceptionFilter {
  catch(exception: Neo4jError, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let statusCode = 500;
    let error = 'Internal Server Error';
    let message: string[] | undefined = undefined;

    // Neo.ClientError.Schema.ConstraintValidationFailed
    // Node(54776) already exists with label `User` and property `email` = 'duplicate@email.com'
    if (exception.message.includes('already exists with')) {
      statusCode = 400;
      error = 'Bad Request';

      const matches = exception.message.match(/`([^`]+)`/g);
      if (matches && matches.length >= 2) {
        const property = matches[1].replace(/`/g, '');
        message = [`${property} already taken`];
      } else {
        message = ['Duplicate key error'];
      }
    }
    // Neo.ClientError.Schema.ConstraintValidationFailed
    // Node(54778) with label `Test` must have the property `mustExist`
    else if (exception.message.includes('must have the property')) {
      statusCode = 400;
      error = 'Bad Request';

      const matches = exception.message.match(/`([^`]+)`/g);
      if (matches && matches.length >= 2) {
        const property = matches[1].replace(/`/g, '');
        message = [`${property} should not be empty`];
      } else {
        message = ['Missing required property'];
      }
    }

    response.status(statusCode).json({
      statusCode,
      message,
      error,
    });
  }
}
