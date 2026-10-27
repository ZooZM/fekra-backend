export class ResponseDto<T> {
  success: boolean;
  //   statusCode: number;
  message: string;
  data?: T;
  meta?: any;

  constructor(success: boolean, message: string, data?: T) {
    this.success = success;
    // this.statusCode = statusCode;
    this.message = message;
    this.data = data;
  }
}
