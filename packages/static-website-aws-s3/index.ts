import _ from 'radash'
import * as pulumi from '@pulumi/pulumi'
import * as aws from '@pulumi/aws'
import fs from 'fs-extra'
import {
  DeploymentContext
} from '@exobase/client-js'
import {
  AWSS3StaticWebsite,
} from '@exobase/pulumi-aws-s3-static-website'


type Config = {
  distDir: string
  preBuildCommand: string
  buildCommand: string
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
  //  CREATE SITE RESOURCES
  //
  const site = new AWSS3StaticWebsite('main', {
    sourceDir: `${__dirname}/source`,
    distDir: `${__dirname}/source/dist`,
    preBuildCommand: config.preBuildCommand,
    buildCommand: config.buildCommand,
    domain: service.domain
  }, { provider })

  return {
    url: service.domain ? service.domain.fqd : site.cdn.domainName
  }
}

export default main()