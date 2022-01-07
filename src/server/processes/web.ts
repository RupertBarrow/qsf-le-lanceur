import logger from 'heroku-logger';
import express from 'express';

import ua from 'universal-analytics';
import path from 'path';
import jsforce from 'jsforce';

// RBW FIXME
//import cors from 'cors';

import { putDeployRequest, getKeys, cdsDelete, cdsRetrieve, cdsPublish, putLead, getAllPooledOrgIDs } from '../lib/redisNormal';
import { deployMsgBuilder } from '../lib/deployMsgBuilder';
import { utilities } from '../lib/utilities';
import { getPoolKey } from '../lib/namedUtilities';
import { multiTemplateURLBuilder } from '../lib/multiTemplateURLBuilder';

import { processWrapper } from '../lib/processWrapper';

import { DeployRequest } from '../lib/types';
import { CDS } from '../lib/CDS';

const app: express.Application = express();
const port = processWrapper.PORT;

/*
 * RBW FIXME
 *

app.use(cors({
    origin : '*',
    methods: ['GET','POST','DELETE','UPDATE','PUT','PATCH'],
    allowedHeaders: ['X-Requested-With', 'Content-Type']
}));
*/

app.listen(port, () => {
  logger.info(`Example app listening on port ${port}!`);
});

// app.use(favicon(path.join(__dirname, 'assets/favicons', 'favicon.ico')));
app.use(express.static('dist'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

function wrapAsync(fn: any) {
  return function (req, res, next) {
    // Make sure to `.catch()` any errors and pass them along to the `next()`
    // middleware in the chain, in this case the error handler.
    fn(req, res, next).catch(next);
  };
}

const commonDeploy = async (req, url: string) => {
  const message: DeployRequest = await deployMsgBuilder(req);

  if (message.visitor && !message.noPool) {
    message.visitor.pageview(url).send();
    message.visitor.event('Repo', getPoolKey(message, '-')).send();
  }

  utilities.runHerokuBuilder();
  await Promise.all([
    putDeployRequest(message),
    cdsPublish( new CDS({ deployId: message.deployId}) )
  ]);

  return message;
};

app.post(
  '/trial',
  wrapAsync(async (req, res, next) => {
    const [message] = await Promise.all([
      commonDeploy(req, '/trial'),
      putLead(req.body)
    ]);
    logger.debug('trial request', message);
    res.redirect(`/#deploying/trial/${message.deployId.trim()}`);
  })
);

app.post(
  '/delete',
  wrapAsync(async (req, res, next) => {
    await cdsDelete(req.body.deployId);
    res.send({ redirectTo: '/#deleteConfirm' });
  })
);

//////////////////////////////////////////////////////////////////
//  LAUNCH : create a scratch org and deploy repo to it

app.get(
  '/launch',
  wrapAsync(async (req, res, next) => {
    // allow repos to require the email parameter
    if (req.query.email === 'required') {
      return res.redirect(multiTemplateURLBuilder(req.query.template, '/#userinfo'));
    }

    const message = await commonDeploy(req, '/launch');
    res.send({
      deployId: `${message.deployId.trim()}`
    });
    //return res.redirect(`/#deploying/deployer/${message.deployId.trim()}`);
  })
);

app.get(['/', '/error', '/deploying/:format/:deployId', '/userinfo', '/byoo', '/testform', '/deleteConfirm'], (req, res, next) => {
  res.sendFile('index.html', { root: path.join(__dirname, '../../../dist') });
});

app.get(['/byoo'], (req, res, next) => {
  if (processWrapper.BYOO_CALLBACK_URI && processWrapper.BYOO_CONSUMERKEY && processWrapper.BYOO_SECRET) {
    res.sendFile('index.html', { root: path.join(__dirname, '../../../dist') });
  } else {
    setImmediate(() => {
      next(new Error('Connected app credentials not properly configured for Bring Your Own Org feature'));
    });
  }
});

app.get(
  '/pools',
  wrapAsync(async (req, res, next) => {
    const keys = await getKeys();
    res.send(keys);
  })
);

app.get(
  '/pools/:poolname',
  wrapAsync(async (req, res, next) => {
    const orgIDs = await getAllPooledOrgIDs(req.params.poolname);
    res.send(orgIDs);
  })
);

app.get(
  '/results/:deployId',
  wrapAsync(async (req, res, next) => {
    const results = await cdsRetrieve(req.params.deployId);
    res.send(results);
  })
);

app.get(['/favicons/favicon.ico', '/favicon.ico'], (req, res, next) => {
  res.sendFile('favicon.ico', { root: path.join(__dirname, '../../../dist/resources/favicons') });
});

app.get('/service-worker.js', (req, res, next) => {
  res.sendStatus(200);
});


//////////////////////////////////////////////////////////////////
//  BYOO : get authentication URL

app.get(
  '/authUrl',
  wrapAsync(async (req, res, next) => {
    const byooOauth2 = new jsforce.OAuth2({
      redirectUri:  processWrapper.BYOO_CALLBACK_URI ?? `http://localhost:${port}/token`,
      clientId:     processWrapper.BYOO_CONSUMERKEY,
      clientSecret: processWrapper.BYOO_SECRET,
      loginUrl:     req.query.base_url
    });
    // console.log('state will be', JSON.stringify(req.query));
    res.send(
      byooOauth2.getAuthorizationUrl({
        scope: 'api id web openid',
        state: JSON.stringify(req.query)
      })
    );
  })
);

app.get(
  '/token',
  wrapAsync(async (req, res, next) => {
    const state = JSON.parse(req.query.state);
    // console.log(`state`, state);
    const byooOauth2 = new jsforce.OAuth2({
      redirectUri:  processWrapper.BYOO_CALLBACK_URI ?? `http://localhost:${port}/token`,
      clientId:     processWrapper.BYOO_CONSUMERKEY,
      clientSecret: processWrapper.BYOO_SECRET,
      loginUrl:     state.base_url
    });
    const conn = new jsforce.Connection({ oauth2: byooOauth2 });
    const userinfo = await conn.authorize(req.query.code);

    // put the request in the queue
    const message = await commonDeploy({
      query: {
        template: state.template
      },
      byoo: {
        accessToken: conn.accessToken,
        instanceUrl: conn.instanceUrl,
        username:    userinfo.id,
        orgId:       userinfo.organizationId
      }
    },
      'byoo'
    );

    return res.redirect(`/#deploying/deployer/${message.deployId.trim()}`);
  })
);


//////////////////////////////////////////////////////////////////
//  API : Get AuthURL with encoded BYOO info

app.get(
  '/api/authUrl2',
  wrapAsync(async (req, res, next) => {
    const byooOauth2 = new jsforce.OAuth2({
      redirectUri:  req.query.byooCallbackURI,
      clientId:     req.query.byooConsumerKey,
      clientSecret: req.query.byooSecret,
      loginUrl:     req.query.base_url
    });
    // console.log('state will be', JSON.stringify(req.query));
    res.send(
      byooOauth2.getAuthorizationUrl({
        scope: 'api id web openid',
        state: JSON.stringify(req.query)
      })
    );
  })
);

//////////////////////////////////////////////////////////////////
//  API : OAuth callback URL for authentication, returns everything needed for byoo

app.get(
  '/api/token2',
  wrapAsync(async (req, res, next) => {
    logger.debug(`### In /api/token2 : req = ${req}`);
    logger.debug(`### In /api/token2 : state = ${req.query.state}`);

    const state = JSON.parse(req.query.state);
    logger.debug(`### In /api/token2 : json state = ${state}`);
    // console.log(`state`, state);
    
    const byooOauth2 = new jsforce.OAuth2({
      redirectUri:  state.byooCallbackURI,
      clientId:     state.byooConsumerKey,
      clientSecret: state.byooSecret,
      loginUrl:     state.base_url
    });
    logger.debug(`### JSForce OK : byooOauth2 = ${byooOauth2}`);

    const conn = new jsforce.Connection({ oauth2: byooOauth2 });
    const userinfo = await conn.authorize(req.query.code);

    // Renvoie le deployId pour suivre le déploiement
    res.send({
      template:    state.template,
      accessToken: conn.accessToken,
      instanceUrl: conn.instanceUrl,
      username:    userinfo.id,
      orgId:       userinfo.organizationId
    });
  })
);

//////////////////////////////////////////////////////////////////
//  API : Call BYOO with all the authentication parameters

app.get(
  '/api/byoo2',
  wrapAsync(async (req, res, next) => {
    //const state = JSON.parse(req.query.state);
    //console.log(`state`, state);

    // put the request in the queue
    const message = await commonDeploy({
      query: {
        template:    req.query.template
      },
      byoo: {
        accessToken: req.query.accessToken,
        instanceUrl: req.query.instanceUrl,
        username:    req.query.username,
        orgId:       req.query.orgId
      }
    },
      'byoo'
    );

    // Renvoie le deployId pour suivre le déploiement
    res.send({
      deployId: `${message.deployId.trim()}`
    });
  })
);

//////////////////////////////////////////////////////////////////
//  API : Run a single SFDX command

// RBW TODO : prendre en compte isRunSfdxCommand :
// - deployMsgBuilder.ts : l51 DeployRequest, 
// - linesParse.ts : l121 parsedLines, cas particuliers comme isByoo
// - lines.ts : cas particuliers comme isByoo

app.get(
  '/api/sfdx',
  wrapAsync(async (req, res, next) => {
    logger.debug(`### /api/sfdx : req.query.sfdxAuthUrl = ${req.query.sfdxAuthUrl}`)
    logger.debug(`### /api/sfdx : req.query.sfdxCommand = ${req.query.sfdxCommand}`)

    //const state = JSON.parse(req.query.state);
    // console.log(`state`, state);

    // put the request in the queue
    const message = await commonDeploy({
      query: {
        do: 'runCommand'
      },
      sfdx: {
        authUrl: req.query.sfdxAuthUrl || 'force://PlatformCLI::5Aep8615Ke.xzM1pWLiDs0K4MbHdWdWIR4hgL2jJW86KAPnMSRMyW56xiqbvpWAJoA3gezZurBFyqaSN65Z8g.z@rbarrow-dev-ed.my.salesforce.com',
        command: req.query.sfdxCommand || 'sfdx force:org:display --verbose --json | grep accessToken'
      }
    },
      'byoo'
    );

    logger.debug(`### /api/sfdx : message = ${message}`)

    // Renvoie le deployId pour suivre le déploiement
    res.send({
      deployId: `${message.deployId.trim()}`
    });
  })
);

app.get('*', (req, res, next) => {
  setImmediate(() => {
    next(new Error(`Route not found: ${req.url} on action ${req.method}`));
  });
});

app.use((error, req, res, next) => {
  if (processWrapper.UA_ID) {
    const visitor = ua(processWrapper.UA_ID);
    // TODO handle array of templates
    visitor.event('Error', req.query.template).send();
  }
  logger.error(`request failed: ${req.url}`);
  logger.error(error);
  return res.redirect(`/#error?msg=${error}`);
});

// process.on('unhandledRejection', e => {
//     logger.error('this reached the unhandledRejection handler somehow:', e);
// });
