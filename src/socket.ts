import { EventEmitter } from 'events'

declare const Java

const J = {
  ByteBuffer: Java.type('java.nio.ByteBuffer'),
  Charset: Java.type('java.nio.charset.Charset'),
  InetSocketAddress: Java.type('java.net.InetSocketAddress'),
  ServerSocket: Java.type('java.nio.channels.AsynchronousServerSocketChannel'),
  Socket: Java.type('java.nio.channels.AsynchronousSocketChannel'),
  Throwable: Java.type('java.lang.Throwable'),
}

const utf8 = J.Charset.forName('utf-8')
const linefeed = utf8.encode("\n").rewind().get()

export type SocketServerOptions = {}

export class SocketServer extends EventEmitter {
  _serverSocket: typeof J.ServerSocket

  constructor(opts: SocketServerOptions, connectionListener?: (socket: Socket) => void) {
	  super()
	  
	  if (typeof connectionListener !== 'undefined') {
	    this.on('connection', connectionListener)
	  }
  }

  bind(port: number, host?: string, backlog?: number, callback?: () => void): void {
	  const backlogSize = typeof backlog !== 'undefined' ? backlog : 511
	  if (typeof callback !== 'undefined') {
	    this.on('listening', callback)
	  }

	  const completionHandler = {
	    completed: ((jSocket: typeof Socket, _: null): void => {
		    try {
		      // Depending on how GraalVM handles things, may need to do
		      // some Promise.resolve().then(...) shenanigans. Initially
		      // trying it raw though.
		      this._serverSocket.accept(null, completionHandler)

		      const socket = new Socket({
			      javaSocket: jSocket
		      })
		      // set options?
		      this.emit('connection', socket)
		    } catch (err) {
		      this.emit('error', err)
		    }
	    }).bind(this),

	    failed: ((err: typeof J.Throwable, _: null): void => {
		    this.emit('error', err)
	    }).bind(this)
	  }

	  try {
	    const socketAddress = typeof host !== 'undefined'
		    ? new J.InetSocketAddress(host, port)
		    : new J.InetSocketAddress(port)

	    this._serverSocket = J.ServerSocket
		    .open()
		    .bind(socketAddress)

	    this._serverSocket.accept(null, completionHandler)
	    this.emit('listening')
	  } catch (err) {
	    if (typeof callback !== 'undefined') {
		    this.removeListener('listening', callback)
	    }
	    this.emit('error', err)
	  }
  }

  close(callback?: () => void): void {
	  if (typeof callback !== 'undefined') {
	    this.on('close', callback)
	  }

	  try {
	    this._serverSocket.close()
	    this.emit('close')
	  } catch (err) {
	    if (typeof callback !== 'undefined') {
		    this.removeListener('close', callback)
	    }
	    this.emit('error', err)
	  }
  }
}

export type SocketOptions = {
  javaSocket: typeof J.Socket | null
}

export class Socket extends EventEmitter {
  _socket: typeof J.Socket
  readBuffer: typeof J.ByteBuffer

  constructor(opts: SocketOptions) {
	  super()

	  this.readBuffer = J.ByteBuffer.allocate(8192)

	  if (opts.javaSocket !== null) {
	    this._socket = opts.javaSocket

	    this.doRead()
	  } else {
	    // We're not really ready to deal with this being used as
	    // a client yet...
	    throw new Error("graaljs-socket can't be used as a client yet :(")
	  }
  }

  write(data: string, callback?: () => void): void {
	  if (typeof callback !== 'undefined') {
	    this.once('drain', callback)
	  }

	  try {
	    const completionHandler = {
		    completed: ((bytes: number, _: null): void => {
		      this.emit('drain')
		    }).bind(this),

		    failed: ((err: typeof J.Throwable, _: null): void => {
		      this.emit('error', err)
		    }).bind(this)
	    }

	    const buffer = utf8.encode(data)
	    buffer.rewind()
	    this._socket.write(buffer, null, completionHandler)
	  } catch (err) {
	    this.emit('error', err)
	  }
  }

  private doRead(): void {
	  const completionHandler = {
	    // currently don't handle -1 bytes
	    completed: ((bytes: number, _: null): void => {
		    if (bytes === -1) {
		      // End of stream
		      this.emit('end')
		      this.removeAllListeners()
		      this._socket.close()
		    } else {
		      this.readBuffer.rewind()

		      let outBytes = []
		      for (let i=0;i<bytes;i++) {
			      const byte = this.readBuffer.get()
			      outBytes.push(byte)
			      if (byte === linefeed) {
			        this.readBuffer.compact()
			        this.readBuffer.rewind()
			        const msg = utf8.decode(J.ByteBuffer.wrap(outBytes)).toString()
			        outBytes = []
			        this.emit('data', msg)
			      }
		      }
		      this.doRead()
		    }
	    }).bind(this),

	    failed: ((err: typeof J.Throwable, _: null): void => {
		    this.emit('error', err)
	    }).bind(this)
	  }
	  this._socket.read(this.readBuffer, null, completionHandler)
  }
}
