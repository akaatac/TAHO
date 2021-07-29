import { EventEmitter } from "events"
import Provider from "./provider"
import Subscription from "./subscription"

/*
  should do caching

  TODO'S:
  - http polling subscriptions
  - filterers
*/

export default class EthereumNetworkProvider extends Provider {
  subscriptions: {
    [index: string]: Subscription
  }

  _cache: any

  _subscriptionIds: any

  constructor(endpoint: string) {
    super(endpoint)
    this.subscriptions = {}
    // private vars
    this._cache = {}
    this._subscriptionIds = {}
  }

  // handler only for unsubscribe
  async request(request: any, handler?: (any) => unknown) {
    const { params } = request
    if (request.method === "eth_subscribe") {
      const [name] = params
      const subscription = this.subscriptions[name]
      if (subscription) return subscription.id

      const id = await super.request(request)
      // map for subcription id's
      this._subscriptionIds[id] = name
      // acctual subcription interface
      this.subscriptions[name] = new Subscription(name, id)
      this.transport.socket.addEventListener(
        "message",
        this.subscriptions[name].handler.bind(this.subscriptions[name])
      )
      return id
    }
    if (request.method === "eth_unsubscribe") {
      const { params: unsubscribeParams } = request
      const [id] = unsubscribeParams
      const name = this._subscriptionIds[id]
      if (!this.subscriptions[name]) return false
      const subscription = this.subscriptions[name]
      // removes listener and if their are no subcriptions left unsubcribes from the node
      if (handler) subscription.removeListener("update", handler)
      if (!subscription.listeners("update").length) {
        this.transport.socket.removeEventListener(
          "message",
          subscription.handler.bind(subscription)
        )
        const confirmation = await super.request({
          method: "eth_unsubscribe",
          params: [subscription.id],
        })
        return confirmation
      }
      return true
    }
    // cache response and return cache response
    // cache is rest on every new head
    let key
    if (!params || !params.length) key = request.method
    else key = [request.method, ...params].join("/")

    if (!this._cache[key]) {
      this._cache[key] = await super.request(request)
    }

    return this._cache[key]
  }

  async connect() {
    // subscribe to new heads for caching purposes
    await this.request({
      method: "eth_subscribe",
      params: ["newHeads"],
    })
    this.subscriptions.newHeads.on("update", (state) => {
      this._cache = {
        eth_blockNumber: state.number,
      }
    })
  }

  async close() {
    Object.values(this.subscriptions).forEach((subscription) => {
      try {
        subscription.removeAllListeners("update")
        this.transport.socket.removeEventListener(
          "message",
          subscription.handler.bind(subscription)
        )
        this.request({ method: "eth_unsubscribe", params: [subscription.id] })
      } catch (e) {
        console.error(e)
      }
    })
    await this.transport.close()
  }
}
