import _ from 'radash'
import * as pulumi from '@pulumi/pulumi'
import * as aws from '@pulumi/aws'
import fs from 'fs-extra'
import { DeploymentContext } from '@exobase/client-js'
import { AWSLambdaAPI } from '@exobase/pulumi-aws-lambda-api'
import cmd from 'cmdish'


type Config = {
  timeout: number
  memory: number
}

type Outputs = {
  url: pulumi.Output<string> | string
}

const main = async (): Promise<Outputs> => {

  //
  //  READ PROJECT CONFIG
  //
  const context = await fs.readJSON('./context.json') as DeploymentContext
  const {
    platform,
    service,
    deployment
  } = context
  const config = deployment.config.stack as Config


  //
  //  SETUP PROVIDER
  //
  const provider = new aws.Provider('aws', {
    secretKey: platform.providers.aws.accessKeySecret,
    accessKey: platform.providers.aws.accessKeyId,
    region: platform.providers.aws.region as aws.Region
  })


  //
  //  BUILD TYPESCRIPT SOURCE DIR
  //
  const zipPath = await buildTypescriptLambdaZip({
    path: `${__dirname}/source`
  })


  //
  //  CREATE API/LAMBDA RESOURCES
  //
  const api = new AWSLambdaAPI('api', {
    sourceDir: `${__dirname}/source`,
    sourceExt: 'ts',
    sourceZip: zipPath,
    runtime: 'nodejs14.x',
    timeout: config.timeout,
    memory: config.memory,
    environmentVariables: [
      ...deployment.config.environmentVariables,
      {
        name: 'EXOBASE_PLATFORM',
        value: platform.name
      },{
        name: 'EXOBASE_SERVICE',
        value: service.name
      }
    ],
    domain: service.domain
  }, { provider })

  return {
    url: service.domain ? service.domain.fqd : api.api.url
  }
}


const buildTypescriptLambdaZip = async ({
  path
}: {
  path: string
}): Promise<string> => {

  const root = path
  const build = `${root}/build`
  const zip = `${root}/aws-lambda-api.zip`

  const USE_NVM = !!process.env.USE_NVM

  //
  // Add files and install dependencies
  //
  await fs.copy(`${root}/package.json`, `${build}/package.json`)
  if (USE_NVM) {
    const [err] = await cmd('source ~/.nvm/nvm.sh && nvm use && yarn && yarn build && cd build && yarn --prod', { cwd: root })
    if (err) throw err
  } else {
    const [err] = await cmd('yarn && yarn build && cd build && yarn --prod', { cwd: root })
    if (err) throw err
  }

  //
  // Generate new zip
  //
  await cmd(`zip -q -r ${zip} *`, { cwd: build })

  return zip
}


export default main()