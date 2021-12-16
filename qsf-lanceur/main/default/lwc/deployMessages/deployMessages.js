import { LightningElement,api,track,wire } from 'lwc';

const interval_ms = 1000;
const timeoutMS = 1000 * 60 * 30; // 30 minutes, then stop no matter what
const SERVER = 'https://qsf0-le-lanceur.herokuapp.com'

export default class DeployMessages extends LightningElement {
  @track results = {}    // CDS
  _deployId;

  @api
  get deployId() {
    return this._deployId;
  }

  set deployId(value) {
    this._deployId = value;
    this.results = {
      deployId: this.deployId,
    }
  }

  get resultsOutput() {
    return JSON.stringify(this.results);
  }

  get completionPercentage() {
    try {
      if (typeof this.results.lineCount === 'number') {
        return (this.results.commandResults.length / this.results.lineCount) * 100 || 1;
      }
      return 1;
    } catch (e) {
      return 1;
    }
  }

  get loadingDescription() {
    return `Deploying ${this.results.deployId ? this.results.deployId : '...'}`;
  }

  get showMainUser() {
    return this.results && this.results.mainUser && this.results.mainUser.loginUrl;
  }

  get showPassword() {
    return this.results && this.results.mainUser && this.results.mainUser.password;
  }

  get showErrors() {
    return this.results && this.results.errors && this.results.errors.length > 0;
  }

  get showHeroku() {
    return this.results && this.results.herokuResults && this.results.herokuResults.length > 0;
  }

  get showDelete() {
    return this.results && !this.results.isByoo;
  }

  isInitialized = false
  connectedCallback() {
    if (this.isInitialized === false) {
      this.isInitialized = true

      this.doStuff()
    }
  }

  doStuff(config) {
    this.doCalloutRequest('/launch?template=https://github.com/mshanemc/df17appbuilding')
    .then(() => {
      this.doCalloutResponse(config)
    })
  }

  async doCalloutRequest(url) {
    fetch(`${SERVER}${url}`)
    .then(result => result.json())
    .then(result => {
      console.log('REQUEST : res = ', result)

      return result
    })
  }


  async doCalloutResponse(newConfig) {
    let config = {}   // FIXME : where does this come from ?

    config = newConfig;
    if (newConfig?.log) {
      console.log('RESPONSE : new config is', newConfig);
    }

    if (config?.fake) {
      //eventTarget.dispatchEvent(new ValueChangedEvent({ data }));
    } else if (config?.deployId) {
      fetch(`${SERVER}/results/${config.deployId}`)
        .then(result => result.json())
        .then(result => {
          if (config?.log) {
            console.log('RESPONSE : res = ', result)
          }

          this.results = result || {}

          if (result?.complete) {
            //clearInterval(pinger)
          }
        })
    }
  }


  async deleteOrg(e) {
    e.preventDefault()
    e.stopPropagation()

    fetch('${SERVER}/delete',{
      method: 'POST',
      body: JSON.stringify({
        deployId: this.results.deployId,
      }),
      headers: {
        'Content-Type': 'application/json',
      },
    })
      .then(result => result.json())
      .then(response => {
        console.log(response)
        window.location = response.redirectTo
      })
  }

  handleMessage(msg) {
    this.results = msg.detail
  }
}
