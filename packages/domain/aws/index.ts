import _ from 'radash'
// import * as pulumi from '@pulumi/pulumi'
import * as aws from '@pulumi/aws'
// import * as awsx from '@pulumi/awsx'
import fs from 'fs-extra'
import * as t from './types'


const main = async (): Promise<void> => {

  //
  //  READ PROJECT CONFIG
  //
  const context = await fs.readJSON('./context.json') as t.DomainDeploymentContext
  const { platform, domain } = context

  console.log('[PULUMI]: context')
  console.log(JSON.stringify(context))


  //
  //  SETUP PROVIDER
  //
  const provider = new aws.Provider('aws', {
    secretKey: platform.providers.aws.accessKeySecret,
    accessKey: platform.providers.aws.accessKeyId,
    region: platform.providers.aws.region as aws.Region
  })
  

  //
  //  LOOKUP ROUTE53 ZONE
  //
  //  Zone should already be created and have any required setup
  //  done between an external service where the domain is actually
  //  owned if its not owned in AWS and using the defualt NS's.
  //
  const zone = aws.route53.getZone({
    name: domain.domain,
    privateZone: false
  }, { provider })


  //
  //  CREATE CERT
  //
  //  We create two certs. One for the domain and one wildcard 
  //  for all subdomains.
  //
  const domainCert = new aws.acm.Certificate(`${_.dashCase(domain.domain)}-cert`, {
    domainName: domain.domain,
    validationMethod: "DNS"
  }, { provider })
  const subdomainCert = new aws.acm.Certificate(`sub-${_.dashCase(domain.domain)}-cert`, {
    domainName: `*.${domain.domain}`,
    validationMethod: "DNS"
  }, { provider })

  const domainRecords: aws.route53.Record[] = []
  const subdomainRecords: aws.route53.Record[] = []

  domainCert.domainValidationOptions.apply(dvos => {
    for (const dvo of dvos) {
      const record = new aws.route53.Record(`${dvo.domainName}-validate-record`, {
        allowOverwrite: true,
        name: dvo.resourceRecordName,
        records: [dvo.resourceRecordValue],
        ttl: 60,
        type: dvo.resourceRecordType,
        zoneId: zone.then(z => z.zoneId)
      }, { provider })
      domainRecords.push(record)
    }
  })

  subdomainCert.domainValidationOptions.apply(dvos => {
    for (const dvo of dvos) {
      const record = new aws.route53.Record(`sub-${dvo.domainName}-validate-record`, {
        allowOverwrite: true,
        name: dvo.resourceRecordName,
        records: [dvo.resourceRecordValue],
        ttl: 60,
        type: dvo.resourceRecordType,
        zoneId: zone.then(z => z.zoneId)
      }, { provider })
      subdomainRecords.push(record)
    }
  })

  new aws.acm.CertificateValidation(`${_.dashCase(domain.domain)}`, {
    certificateArn: domainCert.arn,
    validationRecordFqdns: domainRecords.map(record => record.fqdn)
  }, { provider })
  
  new aws.acm.CertificateValidation(`sub-${_.dashCase(domain.domain)}`, {
    certificateArn: subdomainCert.arn,
    validationRecordFqdns: subdomainRecords.map(record => record.fqdn)
  }, { provider })

}

export default main()