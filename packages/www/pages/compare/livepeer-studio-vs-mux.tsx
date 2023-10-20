import Layout from "layouts/main";
import CompareHero from "components/Site/Compare/Hero";
import CompareTable from "components/Site/Compare/Table";
import { Container, Flex, Box, Text } from "@livepeer/design-system";
import Prefooter from "components/Site/Prefooter";
import { InfoCircledIcon } from "@radix-ui/react-icons";
import { Compare as CompareContent } from "content";

const Compare = () => {
  return (
    <Layout {...CompareContent.metaData}>
      <Box css={{ position: "relative" }}>
        <Container
          size="3"
          css={{
            py: "$7",
            "@bp3": {
              py: "$8",
            },
          }}>
          <CompareHero
            comparison="Mux"
            title={
              <Box>
                Livepeer Studio <br /> vs Mux
              </Box>
            }
          />
        </Container>
        <Box
          css={{
            mt: "$4",
            pt: "$8",
            bc: "$gray1",
            borderTop: "1px solid $gray4",
            borderBottom: "1px solid $gray4",
            py: "$7",
          }}>
          <Container size={3}>
            <CompareTable comparison="mux" />
            <Box css={{ mt: "$6" }}>
              <Flex align="center" gap={2}>
                <InfoCircledIcon />
                <Text size={2}>
                  All feature and pricing information is sourced from available
                  online information as of 7/28/2023.
                </Text>
              </Flex>
            </Box>
          </Container>
        </Box>
        <Prefooter />
      </Box>
    </Layout>
  );
};

Compare.theme = "light-theme-green";
export default Compare;
